import { bus, toast } from '../../core/events';
import { clamp, money } from '../../core/format';
import { rand } from '../../core/rng';
import { shopById, type GameState } from '../../core/state';
import { EMPLOYEES, EVENTS, PRODUCTS, SHOP_TYPES } from '../../data';
import { batchQty, defOf, type ShopState } from '../../entities/Shop';
import { rt } from '../ai/runtime';
import { earn, spend } from '../economy/finance';
import { takeFromSlot } from '../economy/stock';
import { upgradeLevel } from '../progress/upgrades';
import { isOpenNow } from '../shop/status';
import { fire, hasTrait, onDuty } from '../staff/staff';
import { dayOf } from '../time/clock';

export type EventType = 'rival' | 'viralGood' | 'viralBad' | 'shortage' | 'holiday';

/** Something temporary that is changing the rules. Saved with the game. */
export interface ActiveEvent {
  type: EventType;
  /** Last day it applies. */
  untilDay: number;
  shopId?: number;
  product?: string;
  label: string;
}

export interface NewsItem {
  day: number;
  text: string;
  kind: 'info' | 'good' | 'warn' | 'bad';
}

const C = EVENTS.chances;

/** Record a headline in the news log and show it. */
export function news(s: GameState, text: string, kind: NewsItem['kind'] = 'info'): void {
  s.news.push({ day: dayOf(s.time), text, kind });
  if (s.news.length > 40) s.news.shift();
  toast(text, kind);
  bus.emit('news:changed');
}

const customerShops = (s: GameState): ShopState[] => s.shops.filter((sh) => SHOP_TYPES[sh.type].demand > 0);

/** How strongly events are pulling customers toward or away from one shop. */
export function shopDemandMult(s: GameState, shop: ShopState): number {
  let m = 1 + upgradeLevel(s, shop.id, 'localAds') * 0.15;
  for (const e of s.events) {
    if (e.shopId !== shop.id) continue;
    if (e.type === 'rival') m *= EVENTS.rival.demandMult;
    if (e.type === 'viralGood') m *= EVENTS.viral.goodMult;
    if (e.type === 'viralBad') m *= EVENTS.viral.badMult;
  }
  return m;
}

/** Recompute the crowd multiplier from today's holidays. */
function applyHolidays(s: GameState): void {
  const day = dayOf(s.time);
  let crowd = 1;
  for (const h of EVENTS.holidays) {
    if (day % h.everyDays !== h.offset % h.everyDays) continue;
    crowd = Math.max(crowd, h.crowd);
    if (!s.events.some((e) => e.type === 'holiday' && e.untilDay === day && e.label === h.name)) {
      s.events.push({ type: 'holiday', untilDay: day, label: h.name });
      news(s, `${h.name} today! The streets will be busier than usual.`, 'good');
    }
  }
  rt.crowdMult = crowd;
}

function startRival(s: GameState): void {
  const day = dayOf(s.time);
  const targets = customerShops(s).filter((sh) => !s.events.some((e) => e.type === 'rival' && e.shopId === sh.id));
  if (day < EVENTS.rival.minDay || !targets.length) return;
  const shop = rand.pick(targets);
  const days = rand.int(EVENTS.rival.minDays, EVENTS.rival.maxDays);
  s.events.push({ type: 'rival', untilDay: day + days, shopId: shop.id, label: `Rival ${SHOP_TYPES[shop.type].name.toLowerCase()} near ${shop.name}` });
  news(s, `A rival ${SHOP_TYPES[shop.type].name.toLowerCase()} has opened near ${shop.name}. Expect fewer customers there until it folds. Sharp prices and a good reputation will see it off sooner.`, 'warn');
}

function startViral(s: GameState): void {
  const targets = customerShops(s).filter((sh) => sh.today.customers + sh.yesterday.customers > 5 && !s.events.some((e) => e.shopId === sh.id && (e.type === 'viralGood' || e.type === 'viralBad')));
  if (!targets.length) return;
  const shop = rand.pick(targets);
  const good = rand.chance(clamp((shop.reputation - 20) / 60, 0.1, 0.9));
  s.events.push({ type: good ? 'viralGood' : 'viralBad', untilDay: dayOf(s.time) + EVENTS.viral.days, shopId: shop.id, label: `${good ? 'Glowing' : 'Scathing'} review of ${shop.name}` });
  shop.reputation = clamp(shop.reputation + (good ? 6 : -6), 0, 100);
  news(s, good ? `A glowing review of ${shop.name} is going viral. Brace for a rush.` : `A scathing review of ${shop.name} is doing the rounds online. Customers are staying away.`, good ? 'good' : 'bad');
}

function startShortage(s: GameState): void {
  // Only products the player actually deals in are worth a headline.
  const used = new Set<string>();
  for (const shop of s.shops) for (const p of [...SHOP_TYPES[shop.type].products, ...SHOP_TYPES[shop.type].supplies]) if (PRODUCTS[p].wholesale > 0 && PRODUCTS[p].kind !== 'crafted') used.add(p);
  const free = [...used].filter((p) => !s.events.some((e) => e.type === 'shortage' && e.product === p));
  if (!free.length) return;
  const product = rand.pick(free);
  s.market.mult[product] = (s.market.mult[product] ?? 1) * EVENTS.shortage.priceMult;
  s.events.push({ type: 'shortage', untilDay: dayOf(s.time) + EVENTS.shortage.days, product, label: `${PRODUCTS[product].name} shortage` });
  news(s, `Supply shortage: ${PRODUCTS[product].name.toLowerCase()} prices have jumped ${Math.round((EVENTS.shortage.priceMult - 1) * 100)}%. Customers will accept higher prices for a few days.`, 'warn');
  bus.emit('market:changed');
}

function healthInspection(s: GameState): void {
  const food = s.shops.filter((sh) => SHOP_TYPES[sh.type].flow === 'counter' || sh.type === 'convenience' || sh.type === 'gas');
  if (!food.length) return;
  const shop = rand.pick(food);
  if (shop.dirt > EVENTS.inspection.dirtLimit) {
    const fine = Math.round(rand.range(EVENTS.inspection.fineMin, EVENTS.inspection.fineMax) / 10) * 10;
    spend(s, fine, 'fines');
    shop.today.costs += fine;
    shop.reputation = clamp(shop.reputation - 8, 0, 100);
    news(s, `Health inspection at ${shop.name}: failed. The place was dirty. Fined ${money(fine)}.`, 'bad');
  } else {
    shop.reputation = clamp(shop.reputation + 3, 0, 100);
    news(s, `Health inspection at ${shop.name}: passed with a clean bill of health.`, 'good');
  }
}

/** Shoplifters target shops with stock on open shelves. Guards catch most of them. */
function shoplifting(s: GameState): void {
  for (const shop of s.shops) {
    if (SHOP_TYPES[shop.type].flow !== 'retail' || !isOpenNow(s, shop)) continue;
    const cameras = upgradeLevel(s, shop.id, 'cameras') > 0;
    if (!rand.chance(C.shopliftPerHourPerShop * (cameras ? 0.5 : 1))) continue;
    const slots = shop.objects.flatMap((o) => (defOf(o).kind === 'shelf' ? (o.slots ?? []).filter((sl) => sl.product && batchQty(sl.batches) > 0) : []));
    if (!slots.length) continue;
    const slot = rand.pick(slots);
    const product = slot.product!;
    const guard = s.staff.some((e) => e.shopId === shop.id && e.role === 'security' && onDuty(s, e));
    if (guard && rand.chance(0.75)) {
      news(s, `Security at ${shop.name} stopped a shoplifter going for the ${PRODUCTS[product].name.toLowerCase()}.`, 'good');
      continue;
    }
    // Small expensive things walk out one at a time; cheap things by the armful.
    const taken = takeFromSlot(shop, slot, PRODUCTS[product].market > 10 ? rand.int(1, 2) : rand.int(2, 6));
    if (taken) news(s, `Shoplifter at ${shop.name}: ${taken} ${PRODUCTS[product].name.toLowerCase()} gone (${money(Math.round(taken * shop.prices[product]))} of stock).${guard ? '' : ' A security guard would deter this.'}`, 'warn');
  }
}

/** Staff with sticky fingers skim the till. Cameras or a guard eventually catch them. */
function staffTheft(s: GameState): void {
  for (const e of [...s.staff]) {
    if (!hasTrait(e, 'theft') || e.shopId === null) continue;
    const shop = shopById(s, e.shopId);
    if (!shop || shop.yesterday.revenue <= 0) continue;
    const rate = e.traits.reduce((a, t) => a + (EMPLOYEES.traits[t].theft ?? 0), 0);
    const loss = Math.round(shop.yesterday.revenue * rate);
    if (loss < 1) continue;
    spend(s, loss, 'other');
    const watched = upgradeLevel(s, shop.id, 'cameras') > 0 || s.staff.some((g) => g.shopId === shop.id && g.role === 'security');
    if (watched && rand.chance(0.5)) {
      earn(s, loss, 'refund');
      news(s, `${e.name} was caught skimming the till at ${shop.name} and has been dismissed. The money was recovered.`, 'warn');
      fire(s, e.id, true);
    } else {
      news(s, `The till at ${shop.name} came up ${money(loss)} short yesterday.${watched ? '' : ' Cameras or a guard might show why.'}`, 'warn');
    }
  }
}

/** Rivals close early when the player's shop is clearly winning. */
function expire(s: GameState): void {
  const day = dayOf(s.time);
  for (let i = s.events.length - 1; i >= 0; i--) {
    const e = s.events[i];
    const shop = e.shopId !== undefined ? shopById(s, e.shopId) : undefined;
    const beaten = e.type === 'rival' && shop && shop.reputation >= 72;
    if (e.untilDay >= day && !beaten && !(e.shopId !== undefined && !shop)) continue;
    s.events.splice(i, 1);
    if (e.type === 'rival' && shop) news(s, beaten ? `The rival near ${shop.name} could not compete with you and has closed.` : `The rival near ${shop.name} has gone out of business.`, 'good');
    if (e.type === 'shortage' && e.product) {
      s.market.mult[e.product] = (s.market.mult[e.product] ?? 1) / EVENTS.shortage.priceMult;
      news(s, `${PRODUCTS[e.product].name} supplies are back to normal.`, 'info');
      bus.emit('market:changed');
    }
  }
}

/** Start-of-day events. */
export function eventsDaily(s: GameState): void {
  expire(s);
  applyHolidays(s);
  staffTheft(s);
  if (rand.chance(C.rivalPerDay)) startRival(s);
  if (rand.chance(C.viralPerDay)) startViral(s);
  if (rand.chance(C.shortagePerDay)) startShortage(s);
  if (rand.chance(C.inspectionPerDay)) healthInspection(s);
  bus.emit('news:changed');
}

export function eventsHourly(s: GameState): void {
  shoplifting(s);
}

/** Restore runtime effects of saved events after loading. */
export function initEvents(s: GameState): void {
  applyHolidays(s);
}
