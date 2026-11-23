import { bus } from '../../core/events';
import { clamp, money } from '../../core/format';
import { rand } from '../../core/rng';
import { session, type GameState } from '../../core/state';
import { EVENTS, NEIGHBORHOODS, PRODUCTS, SHOP_TYPES } from '../../data';
import { batchQty, defOf, type ShopState } from '../../entities/Shop';
import { claim, taxableProfit } from '../economy/corporate';
import { earn, spend } from '../economy/finance';
import { wholesalePrice } from '../economy/market';
import { upgradeLevel } from '../progress/upgrades';
import { dayOf } from '../time/clock';
import { news } from './events';

/**
 * Things that happen to a business whether it likes it or not: fires, floods, power cuts,
 * roadworks, crazes, famous visitors, critics, walk-outs, audits and the odd stroke of luck.
 */
const R = EVENTS.random;

const customerShops = (s: GameState): ShopState[] => s.shops.filter((sh) => SHOP_TYPES[sh.type].demand > 0);
const districtOf = (shop: ShopState): string => session.city.lots[shop.lotId].district;

/** Close a shop until a game minute; trading resumes by itself. */
function closeUntil(shop: ShopState, minute: number): void {
  shop.closedUntil = Math.max(shop.closedUntil ?? 0, minute);
  bus.emit('shop:changed', shop.id);
}

function fire(s: GameState): void {
  const shops = s.shops.filter((sh) => sh.objects.length > 2);
  if (!shops.length) return;
  const shop = rand.pick(shops);
  const sprinklers = upgradeLevel(s, shop.id, 'sprinklers') > 0;
  const share = R.fire.damageShare * (sprinklers ? 0.33 : 1);
  let damage = 0;
  for (const o of shop.objects) {
    if (o.broken || !rand.chance(share)) continue;
    o.broken = true;
    damage += defOf(o).repairCost ?? Math.round(defOf(o).cost * 0.25);
  }
  closeUntil(shop, s.time.minutes + R.fire.closedHours * 60 * (sprinklers ? 0.4 : 1));
  shop.dirt = clamp(shop.dirt + 40, 0, 100);
  const paid = claim(s, 'disaster', damage);
  news(s, `Fire at ${shop.name}! ${sprinklers ? 'The sprinklers caught most of it. ' : ''}Equipment is damaged (about ${money(damage)} to repair) and the shop is shut while it is cleared up.${paid ? ` Your insurer paid ${money(paid)}.` : ' Fire and flood cover would have paid for this.'}`, 'bad');
}

function flood(s: GameState): void {
  const shops = s.shops.filter((sh) => Object.values(sh.storage).some((b) => batchQty(b) > 0));
  if (!shops.length) return;
  const shop = rand.pick(shops);
  let loss = 0;
  for (const [p, batches] of Object.entries(shop.storage)) {
    if (PRODUCTS[p].storage === 'vehicle') continue;
    for (const b of batches) {
      const gone = Math.floor(b.qty * R.flood.stockLoss);
      b.qty -= gone;
      loss += gone * wholesalePrice(s, p);
    }
  }
  shop.dirt = clamp(shop.dirt + R.flood.dirt, 0, 100);
  bus.emit('stock:changed', shop.id);
  const paid = claim(s, 'disaster', loss);
  news(s, `A pipe has burst at ${shop.name}. The back room is flooded: ${money(Math.round(loss))} of stock is ruined and the place needs a deep clean.${paid ? ` Your insurer paid ${money(paid)}.` : ''}`, 'bad');
}

function powercut(s: GameState): void {
  const districts = [...new Set(s.shops.map(districtOf))];
  if (!districts.length) return;
  const district = rand.pick(districts);
  const hit = s.shops.filter((sh) => districtOf(sh) === district);
  const dark = hit.filter((sh) => upgradeLevel(s, sh.id, 'generator') === 0);
  for (const shop of dark) closeUntil(shop, s.time.minutes + R.powercut.hours * 60);
  news(s, `Power cut in ${NEIGHBORHOODS[district].name} for about ${R.powercut.hours} hours.${dark.length ? ` ${dark.map((sh) => sh.name).join(', ')} cannot trade until it is back.` : ''}${hit.length > dark.length ? ' Your generators are keeping the rest open.' : ' A backup generator would keep a shop open.'}`, dark.length ? 'bad' : 'info');
}

function roadworks(s: GameState): void {
  const districts = [...new Set(customerShops(s).map(districtOf))].filter((d) => !s.events.some((e) => e.type === 'roadworks' && e.district === d));
  if (!districts.length) return;
  const district = rand.pick(districts);
  s.events.push({ type: 'roadworks', untilDay: dayOf(s.time) + R.roadworks.days - 1, district, label: `Roadworks in ${NEIGHBORHOODS[district].name}` });
  news(s, `Roadworks have started in ${NEIGHBORHOODS[district].name}. Fewer people will come to your shops there for ${R.roadworks.days} days.`, 'warn');
}

function trend(s: GameState): void {
  const products = [...new Set(customerShops(s).flatMap((sh) => SHOP_TYPES[sh.type].products))].filter((p) => PRODUCTS[p].market > 0 && PRODUCTS[p].storage !== 'vehicle' && !s.events.some((e) => e.type === 'trend'));
  if (!products.length) return;
  const product = rand.pick(products);
  s.events.push({ type: 'trend', untilDay: dayOf(s.time) + R.trend.days - 1, product, label: `Everyone wants ${PRODUCTS[product].name.toLowerCase()}` });
  news(s, `${PRODUCTS[product].name} is all over social media. Demand for it will be several times normal for ${R.trend.days} days: stock up.`, 'good');
}

function celebrity(s: GameState): void {
  const shops = customerShops(s).filter((sh) => sh.reputation >= 45 && !s.events.some((e) => e.type === 'celebrity' && e.shopId === sh.id));
  if (!shops.length) return;
  const shop = rand.pick(shops);
  shop.reputation = clamp(shop.reputation + R.celebrity.reputation, 0, 100);
  s.events.push({ type: 'celebrity', untilDay: dayOf(s.time) + R.celebrity.days - 1, shopId: shop.id, label: `A famous face at ${shop.name}` });
  news(s, `A well-known actor was photographed at ${shop.name}. Everyone wants to go where they went.`, 'good');
}

function critic(s: GameState): void {
  const shops = s.shops.filter((sh) => SHOP_TYPES[sh.type].flow === 'counter' && sh.today.customers + sh.yesterday.customers > 5);
  if (!shops.length) return;
  const shop = rand.pick(shops);
  // The critic notices what customers notice: the state of the place and how it has been treating people.
  const score = shop.reputation / 100 - shop.dirt / 150 + ((shop.moodAvg ?? 60) - 60) / 100;
  const stars = clamp(Math.round(1 + score * 5 + rand.range(-0.6, 0.6)), 1, 5);
  shop.reviews.unshift({ day: dayOf(s.time), stars, text: stars >= 4 ? 'A real find. Go before the queues do.' : stars <= 2 ? 'Tired, grubby and slow. Avoid.' : 'Perfectly fine, entirely forgettable.', author: 'The City Gazette', persona: 'foodie' });
  shop.reputation = clamp(shop.reputation + (stars - 3) * 3, 0, 100);
  news(s, `The City Gazette reviewed ${shop.name}: ${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}.`, stars >= 4 ? 'good' : stars <= 2 ? 'bad' : 'info');
  bus.emit('review:posted', { shopId: shop.id, stars, text: shop.reviews[0].text });
}

function strike(s: GameState): void {
  for (const shop of s.shops) {
    const team = s.staff.filter((e) => e.shopId === shop.id);
    if (team.length < 2) continue;
    const morale = team.reduce((a, e) => a + e.morale, 0) / team.length;
    if (morale >= R.strike.moraleBelow || !rand.chance(R.strike.perDay)) continue;
    const day = dayOf(s.time);
    for (const e of team) e.absentDay = day;
    news(s, `The staff at ${shop.name} have walked out for the day. Morale there is on the floor: look at pay, hours and how clean the place is.`, 'bad');
    bus.emit('staff:changed');
    return;
  }
}

function audit(s: GameState): void {
  const week = s.finance.history.slice(-7);
  const profit = taxableProfit(week);
  if (profit < 2000) return;
  if (rand.chance(0.5)) return void news(s, 'The tax office went through your books and found them in order.', 'info');
  const fine = Math.round((profit * R.audit.fineShare) / 10) * 10;
  spend(s, fine, 'fines');
  const paid = claim(s, 'liability', fine);
  news(s, `A tax audit found mistakes in your returns. Fined ${money(fine)}.${paid ? ` Your insurer covered ${money(paid)}.` : ''}`, 'bad');
}

function windfall(s: GameState): void {
  if (!s.shops.length) return;
  const amount = Math.round(rand.range(R.windfall.minAmount, R.windfall.maxAmount) / 50) * 50;
  earn(s, amount, 'other');
  news(s, rand.pick([`The city has awarded you a ${money(amount)} small business grant.`, `A supplier found they had overcharged you and refunded ${money(amount)}.`, `A local paper named you business of the month. The prize is ${money(amount)}.`]), 'good');
}

const ROLLS: [keyof typeof R, (s: GameState) => void][] = [['fire', fire], ['flood', flood], ['powercut', powercut], ['roadworks', roadworks], ['trend', trend], ['celebrity', celebrity], ['critic', critic], ['audit', audit], ['windfall', windfall]];

/** Start of day: at most one thing goes wrong (or right), plus any walk-out that is brewing. */
export function randomDaily(s: GameState): void {
  if (dayOf(s.time) < R.minDay || !s.shops.length) return;
  strike(s);
  for (const [id, run] of rand.shuffle([...ROLLS])) {
    const def = R[id] as { perDay: number };
    if (!rand.chance(def.perDay)) continue;
    run(s);
    break;
  }
}

/** Run one event now, for tests and the debug console. */
export function triggerEvent(s: GameState, id: string): void {
  if (id === 'strike') return strike(s);
  ROLLS.find(([k]) => k === id)?.[1](s);
}

/** Extra appetite for a product that is having its moment. */
export const trendBoost = (s: GameState, product: string): number => (s.events.some((e) => e.type === 'trend' && e.product === product) ? R.trend.boost : 1);
