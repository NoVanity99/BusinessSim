import { bus } from '../../core/events';
import { clamp, money } from '../../core/format';
import { rand } from '../../core/rng';
import { session, shopOnLot, type GameState } from '../../core/state';
import { DIFFICULTIES, PRODUCTS, RIVALS as R, SHOP_TYPES } from '../../data';
import type { ShopState } from '../../entities/Shop';
import type { City, LotDef } from '../city/generate';
import { tryPay } from '../economy/finance';
import { news } from '../events/events';
import { fire, hasTrait, skill } from '../staff/staff';
import { dayOf, hourFloat } from '../time/clock';
import { priceIndex } from '../ai/residents';

/**
 * Rival companies. Each one rents free lots and runs shops that compete with the player's
 * for the same residents. Once a day every company looks at how its shops did and at what
 * the player is doing, then adjusts prices, opens or closes shops, and may try to hire the
 * player's staff away. Saved with the game.
 */
export interface RivalShop {
  id: number;
  lotId: number;
  type: string;
  name: string;
  /** Prices relative to market: 1.0 is the going rate. */
  priceIndex: number;
  /** 0-100, comparable to a player shop's reputation. */
  quality: number;
  openedDay: number;
  /** Last day of a sale, or 0. */
  saleUntil: number;
  /** Residents who walked in today / yesterday. */
  today: number;
  yesterday: number;
  /** Smoothed daily profit. */
  profitAvg: number;
}

export interface RivalCompany {
  id: number;
  name: string;
  short: string;
  color: string;
  roof: string;
  aggression: number;
  cash: number;
  shops: RivalShop[];
}

/** A rival's offer to one of the player's employees. */
export interface PoachOffer {
  staffId: number;
  companyId: number;
  wage: number;
  /** The employee leaves at the start of this day unless the offer is matched. */
  day: number;
}

/** Make sure the city has its rival companies (new game, or a save from before they existed). */
export function ensureRivals(s: GameState): void {
  if (s.rivals.length) return;
  s.rivals = R.companies.map((c, i) => ({ id: i + 1, name: c.name, short: c.short, color: c.color, roof: c.roof, aggression: c.aggression, cash: Math.round(rand.range(R.startCash[0], R.startCash[1])), shops: [] }));
}

export const allRivalShops = (s: GameState): RivalShop[] => s.rivals.flatMap((c) => c.shops);
export const rivalOnLot = (s: GameState, lotId: number): RivalShop | undefined => allRivalShops(s).find((r) => r.lotId === lotId);
export const companyOf = (s: GameState, shop: RivalShop): RivalCompany => s.rivals.find((c) => c.shops.includes(shop))!;
/** Any shop on the map that is not the player's own: a rival's or a franchise. */
export const rivalById = (s: GameState, id: number): RivalShop | undefined => allRivalShops(s).find((r) => r.id === id) ?? s.franchises.find((f) => f.id === id);
/** Whatever stands on a lot that the player cannot rent: a rival's shop or one of their own franchises. */
export const occupantOf = (s: GameState, lotId: number): RivalShop | undefined => rivalOnLot(s, lotId) ?? s.franchises.find((f) => f.lotId === lotId);
/** Every company with buildings to draw: the rivals, and the player's franchisees under the player's colour. */
export const brandsOnMap = (s: GameState): { name: string; color: string; roof: string; shops: RivalShop[] }[] => [
  ...s.rivals,
  { name: s.companyName, color: '#2f9e7f', roof: 'house', shops: s.franchises },
  // Tenants on lots the player owns: ordinary premises, drawn in a neutral colour.
  {
    name: 'Tenants',
    color: '#6b7688',
    roof: 'office',
    shops: Object.entries(s.lots)
      .filter(([, own]) => own.tenant)
      .map(([id, own]) => ({ id: 1_000_000 + +id, lotId: +id, type: 'convenience', name: own.tenant!.name, priceIndex: 1, quality: 50, openedDay: own.tenant!.sinceDay, saleUntil: 0, today: 0, yesterday: 0, profitAvg: 0 })),
  },
];

export function rivalOpenNow(s: GameState): boolean {
  const h = hourFloat(s.time);
  return h >= R.hours[0] && h < R.hours[1];
}

/** What customers actually pay there today, relative to market. */
export const rivalPrice = (s: GameState, shop: RivalShop): number => shop.priceIndex - (shop.saleUntil >= dayOf(s.time) ? R.saleCut : 0);

/** The tile on the pavement outside a lot's front door. */
export function frontTile(city: City, lot: LotDef): number {
  return (lot.front === 'n' ? lot.y - 1 : lot.y + lot.h) * city.w + lot.x + Math.floor(lot.w / 2);
}

/** How attractive a rival shop is to someone, on the same scale as `shopUtility` for the player's. */
export function rivalUtility(s: GameState, shop: RivalShop, priceSense: number, fromTile: number): number {
  const { city } = session;
  const lot = city.lots[shop.lotId];
  const distance = Math.hypot(lot.x + lot.w / 2 - (fromTile % city.w), lot.y + lot.h / 2 - Math.floor(fromTile / city.w)) / Math.hypot(city.w, city.h);
  let u = 1 + ((shop.quality - 50) / 50) * 0.9;
  u -= distance * 2.2 * (1 - (SHOP_TYPES[shop.type].destination ?? 0));
  u -= (rivalPrice(s, shop) - 1) * 3 * priceSense;
  if (shop.saleUntil >= dayOf(s.time)) u += 0.3;
  return u;
}

/** A rough average spend per visit for a kind of shop. */
function ticket(type: string): number {
  const prices = SHOP_TYPES[type].products.map((p) => PRODUCTS[p].market).filter((m) => m > 0);
  return prices.length ? (prices.reduce((a, b) => a + b, 0) / prices.length) * 1.7 : 8;
}

const lotCentre = (lot: LotDef): { x: number; y: number } => ({ x: lot.x + lot.w / 2, y: lot.y + lot.h / 2 });
const lotDistance = (a: LotDef, b: LotDef): number => Math.hypot(lotCentre(a).x - lotCentre(b).x, lotCentre(a).y - lotCentre(b).y);

/** The player's nearest shop of the same kind within competing distance. */
export function competitorOf(s: GameState, shop: RivalShop): ShopState | undefined {
  const lot = session.city.lots[shop.lotId];
  return s.shops
    .filter((sh) => sh.type === shop.type && lotDistance(lot, session.city.lots[sh.lotId]) <= R.competeRadius)
    .sort((a, b) => lotDistance(lot, session.city.lots[a.lotId]) - lotDistance(lot, session.city.lots[b.lotId]))[0];
}

/** Rival shops of a kind that compete with one of the player's shops. */
export const rivalsNear = (s: GameState, shop: ShopState): RivalShop[] => allRivalShops(s).filter((r) => r.type === shop.type && lotDistance(session.city.lots[r.lotId], session.city.lots[shop.lotId]) <= R.competeRadius);

const freeLots = (s: GameState, city: City): LotDef[] => city.lots.filter((l) => l.rentable && !s.lots[l.id] && !occupantOf(s, l.id));

function openShop(s: GameState, company: RivalCompany): void {
  const { city } = session;
  const day = dayOf(s.time);
  // Go where the money is: kinds of shop the player is doing well with, otherwise anything ordinary.
  const types = Object.entries(SHOP_TYPES).filter(([, t]) => t.demand > 0 && ['retail', 'counter', 'service'].includes(t.flow) && t.unlockLevel <= s.level + 1);
  if (!types.length) return;
  const weights = types.map(([id]) => 1 + (s.shops.filter((sh) => sh.type === id).reduce((a, sh) => a + sh.yesterday.revenue, 0) / 150) * (0.5 + company.aggression));
  let roll = rand.next() * weights.reduce((a, b) => a + b, 0);
  const type = (types.find((_, i) => (roll -= weights[i]) <= 0) ?? types[0])[0];
  if (company.shops.some((sh) => sh.type === type) && rand.chance(0.6)) return;

  let lots = freeLots(s, city).filter((l) => l.w * l.h >= SHOP_TYPES[type].minArea);
  // They take premises that fit the business, not the biggest plot in town.
  const snug = lots.filter((l) => l.w * l.h <= SHOP_TYPES[type].minArea * 2.2);
  if (snug.length) lots = snug;
  if (!lots.length) return;
  // Aggressive companies set up next to the player's best shop of that kind; others pick busy streets.
  const target = s.shops.filter((sh) => sh.type === type).sort((a, b) => b.yesterday.revenue - a.yesterday.revenue)[0];
  let lot: LotDef;
  if (target && rand.chance(0.35 + company.aggression * 0.6)) {
    const tl = city.lots[target.lotId];
    lot = lots.sort((a, b) => lotDistance(a, tl) - lotDistance(b, tl))[rand.int(0, Math.min(2, lots.length - 1))];
  } else lot = rand.pick(lots);
  const cost = R.openCostBase + lot.rent * R.openCostRentDays;
  if (company.cash < cost) return;
  company.cash -= cost;
  const shop: RivalShop = {
    id: s.nextRivalShopId++,
    lotId: lot.id,
    type,
    name: `${company.short} ${rand.pick(R.shopNames[type] ?? R.shopNames.default)}`,
    priceIndex: R.restPrice - company.aggression * 0.08,
    quality: Math.round(rand.range(42, 58) + (1 - company.aggression) * 10),
    openedDay: day,
    saleUntil: 0,
    today: 0,
    yesterday: 0,
    profitAvg: 0,
  };
  company.shops.push(shop);
  const near = competitorOf(s, shop);
  news(s, near ? `${company.name} has opened ${shop.name} near your ${near.name}. Expect a fight for customers.` : `${company.name} has opened ${shop.name}, a new ${SHOP_TYPES[type].name.toLowerCase()}.`, near ? 'warn' : 'info');
  bus.emit('rivals:changed');
  bus.emit('lot:changed', lot.id);
}

function closeShop(s: GameState, company: RivalCompany, shop: RivalShop, why: string): void {
  company.shops.splice(company.shops.indexOf(shop), 1);
  news(s, why, 'good');
  bus.emit('rivals:changed');
  bus.emit('lot:changed', shop.lotId);
}

function runShop(s: GameState, company: RivalCompany, shop: RivalShop, day: number): void {
  const lot = session.city.lots[shop.lotId];
  const type = SHOP_TYPES[shop.type];
  // Besides the residents we saw walk in, a shop does some trade we do not simulate.
  const visits = shop.today + R.baseVisits * (shop.quality / 50) * Math.min(1.5, type.demand * 8);
  const price = shop.priceIndex - (shop.saleUntil >= day - 1 ? R.saleCut : 0);
  // Cutting prices eats straight into the margin.
  const profit = visits * ticket(shop.type) * Math.max(0, R.margin - (1 - price)) - lot.rent - R.dailyOverhead;
  shop.yesterday = shop.today;
  shop.today = 0;
  shop.profitAvg = shop.profitAvg * 0.7 + profit * 0.3;
  company.cash += profit;
  shop.quality = clamp(shop.quality + (profit > 0 ? 0.6 : -0.5) + rand.range(-0.5, 0.5), 25, 85);

  if (day - shop.openedDay >= R.closeAfterDays && shop.profitAvg < R.closeBelowProfit) {
    const beatenBy = competitorOf(s, shop);
    return closeShop(s, company, shop, beatenBy ? `${shop.name} could not compete with your ${beatenBy.name} and has closed down.` : `${shop.name} has gone out of business.`);
  }

  // Pricing. A company short of cash cannot afford a price war.
  const floor = company.cash < 1500 ? 0.96 : R.minPrice;
  const rival = competitorOf(s, shop);
  if (rival) {
    const theirs = priceIndex(s, rival);
    if (theirs < shop.priceIndex - 0.03 && rand.chance(0.2 + company.aggression * 0.5)) {
      const next = clamp(theirs - 0.03 - company.aggression * 0.06, floor, 1.3);
      if (next < shop.priceIndex - 0.02) {
        shop.priceIndex = next;
        news(s, `Price war: ${shop.name} has cut prices to undercut your ${rival.name}.`, 'warn');
      }
    } else if (theirs > shop.priceIndex + 0.12) {
      // No need to be that cheap: sit just under the player.
      shop.priceIndex = clamp(shop.priceIndex + 0.04, floor, theirs - 0.06);
    }
  } else shop.priceIndex += (R.restPrice - shop.priceIndex) * 0.25;
  shop.priceIndex = Math.max(shop.priceIndex, floor);

  if (shop.saleUntil < day && rand.chance(R.saleChance * (1 + company.aggression))) {
    shop.saleUntil = day + R.saleDays - 1;
    if (rival) news(s, `${shop.name} is holding a ${R.saleDays}-day sale. Your ${rival.name} may be quieter.`, 'warn');
  }
}

/** A company tries to hire one of the player's better, underpaid or unhappy employees. */
function poach(s: GameState, company: RivalCompany, day: number): void {
  const targets = s.staff.filter((e) => e.shopId !== null && !hasTrait(e, 'noQuit') && !s.offers.some((o) => o.staffId === e.id) && (e.wage < e.fairWage * 1.05 || e.morale < 55));
  if (!targets.length) return;
  const worth = (e: (typeof targets)[number]): number => skill(e, 'speed') + skill(e, 'friendliness') + skill(e, 'reliability');
  const e = targets.sort((a, b) => worth(b) - worth(a))[0];
  if (worth(e) < 15) return;
  const wage = Math.ceil(Math.max(e.wage, e.fairWage) * (1.12 + company.aggression * 0.15));
  s.offers.push({ staffId: e.id, companyId: company.id, wage, day: day + 1 });
  news(s, `${company.name} has offered ${e.name} ${money(wage)}/hour to leave you. Match it in the Staff window by midnight or they go.`, 'warn');
  bus.emit('staff:changed');
}

/** Pay an employee what a rival offered, so they stay. */
export function matchOffer(s: GameState, staffId: number): void {
  const i = s.offers.findIndex((o) => o.staffId === staffId);
  const e = s.staff.find((x) => x.id === staffId);
  if (i < 0 || !e) return;
  e.wage = Math.max(e.wage, s.offers[i].wage);
  e.morale = clamp(e.morale + 12, 0, 100);
  s.offers.splice(i, 1);
  news(s, `${e.name} is staying, on ${money(e.wage)}/hour.`, 'good');
  bus.emit('staff:changed');
}

/** Start-of-day turn for every rival company. */
export function rivalsDaily(s: GameState): void {
  const day = dayOf(s.time);
  ensureRivals(s);

  // Unanswered offers: the employee goes.
  for (const o of s.offers.filter((x) => x.day <= day)) {
    const e = s.staff.find((x) => x.id === o.staffId);
    const company = s.rivals.find((c) => c.id === o.companyId);
    if (e) {
      news(s, `${e.name} has left to work for ${company?.name ?? 'a rival'}.`, 'bad');
      fire(s, e.id, true);
    }
  }
  s.offers = s.offers.filter((x) => x.day > day && s.staff.some((e) => e.id === x.staffId));

  for (const company of s.rivals) {
    company.cash += R.dailyIncome;
    for (const shop of [...company.shops]) runShop(s, company, shop, day);
    // A lot the player has since taken over (bought out) is no longer theirs.
    company.shops = company.shops.filter((sh) => !s.lots[sh.lotId]);
    // Deep in the red: cut the worst performer loose.
    if (company.cash < -2000 && company.shops.length) {
      const worst = [...company.shops].sort((a, b) => a.profitAvg - b.profitAvg)[0];
      closeShop(s, company, worst, `${company.name} is short of cash and has closed ${worst.name}.`);
      company.cash = 0;
    }
    const cap = Math.min(R.maxShopsCap, R.maxShopsBase + Math.floor(s.shops.length / 2));
    if (day >= R.firstDay && company.cash > 0 && company.shops.length < cap && rand.chance(R.openChance + company.aggression * 0.2)) openShop(s, company);
    if (company.shops.length && s.staff.length && rand.chance(R.poachChance * (0.5 + company.aggression))) poach(s, company, day);
  }
  bus.emit('rivals:changed');
}

export const buyoutPrice = (s: GameState, shop: RivalShop): number => Math.round(((R.buyoutBase + Math.max(0, shop.profitAvg) * R.buyoutProfitDays) * DIFFICULTIES[s.difficulty].costMult) / 100) * 100;

/** Pay a rival to close a shop. The lot becomes free to rent. */
export function buyOut(s: GameState, shop: RivalShop): boolean {
  const company = companyOf(s, shop);
  const price = buyoutPrice(s, shop);
  if (shopOnLot(s, shop.lotId) || !tryPay(s, price, 'property')) return false;
  company.cash += price;
  company.shops.splice(company.shops.indexOf(shop), 1);
  bus.emit('stat', { stat: 'buyouts' });
  news(s, `You bought out ${shop.name} for ${money(price)}. The lot is free.`, 'good');
  bus.emit('rivals:changed');
  bus.emit('lot:changed', shop.lotId);
  return true;
}

/** A company's worth, for comparing against the player. */
export const companyValue = (c: RivalCompany): number => Math.round(c.cash + c.shops.reduce((a, sh) => a + R.openCostBase + Math.max(0, sh.profitAvg) * 20, 0));
