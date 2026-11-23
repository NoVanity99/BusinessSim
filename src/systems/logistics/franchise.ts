import { bus } from '../../core/events';
import { clamp, money } from '../../core/format';
import { rand } from '../../core/rng';
import { session, type GameState } from '../../core/state';
import { LOGISTICS, NEIGHBORHOODS, POPULATION, PRODUCTS, SHOP_TYPES } from '../../data';
import type { ShopState } from '../../entities/Shop';
import { earn, tryPay } from '../economy/finance';
import { news } from '../events/events';
import { rivalOnLot, type RivalShop } from '../rivals/rivals';
import { dayOf } from '../time/clock';

const F = LOGISTICS.franchise;

/**
 * Franchising. Once one of your shops has made a name for itself, people apply to open
 * their own under your brand. They pay a fee up front and a share of their takings every
 * day; in return their standards reflect on every shop you run of that kind.
 */
export interface FranchiseOffer {
  id: number;
  type: string;
  lotId: number;
  applicant: string;
  /** How good an operator they are, 0-100. Shown as a rough impression only. */
  quality: number;
  fee: number;
  /** The offer lapses after this day. */
  untilDay: number;
}

/** A franchised shop. Shaped like a rival's shop so residents can choose it the same way. */
export type Franchise = RivalShop & { owner: string };

export const franchiseOnLot = (s: GameState, lotId: number): Franchise | undefined => s.franchises.find((f) => f.lotId === lotId);

/** The flagship a brand rests on: your best shop of a kind, if it is good enough to franchise. */
export function flagship(s: GameState, type: string): ShopState | undefined {
  const day = dayOf(s.time);
  return s.shops
    .filter((sh) => sh.type === type && sh.reputation >= F.minReputation && sh.history.length >= F.minDays && sh.history.slice(-3).every((d) => d.revenue > d.costs) && day > F.minDays)
    .sort((a, b) => b.reputation - a.reputation)[0];
}

export const franchisable = (type: string): boolean => SHOP_TYPES[type].demand > 0 && !SHOP_TYPES[type].bigTicket && ['retail', 'counter', 'service'].includes(SHOP_TYPES[type].flow);

function ticket(type: string): number {
  const prices = SHOP_TYPES[type].products.map((p) => PRODUCTS[p].market).filter((m) => m > 0);
  // A typical visit is modest even where the price list is not.
  return prices.length ? Math.min(45, (prices.reduce((a, b) => a + b, 0) / prices.length) * 1.7) : 8;
}

/** Now and then someone applies to open one of your brands. */
function maybeOffer(s: GameState): void {
  const day = dayOf(s.time);
  if (s.franchiseOffers.length >= 2 || !rand.chance(F.offerChance)) return;
  const types = [...new Set(s.shops.map((sh) => sh.type))].filter((t) => franchisable(t) && flagship(s, t) && s.franchises.filter((f) => f.type === t).length < F.maxPerShopType && !s.franchiseOffers.some((o) => o.type === t));
  if (!types.length) return;
  const type = rand.pick(types);
  const lots = session.city.lots.filter((l) => l.rentable && !s.lots[l.id] && !rivalOnLot(s, l.id) && !franchiseOnLot(s, l.id) && l.w * l.h >= SHOP_TYPES[type].minArea && l.w * l.h <= SHOP_TYPES[type].minArea * 2.5);
  if (!lots.length) return;
  const lot = rand.pick(lots);
  const offer: FranchiseOffer = {
    id: s.nextFranchiseId++,
    type,
    lotId: lot.id,
    applicant: `${rand.pick(POPULATION.firstNames)} ${rand.pick(POPULATION.lastNames)}`,
    quality: Math.round(rand.range(30, 85)),
    fee: Math.round((F.fee * (0.8 + NEIGHBORHOODS[lot.district].footTraffic * 0.3)) / 100) * 100,
    untilDay: day + 2,
  };
  s.franchiseOffers.push(offer);
  news(s, `${offer.applicant} wants to open a ${flagship(s, type)!.name} franchise in ${NEIGHBORHOODS[lot.district].name}. See the Company window.`, 'info');
}

/** A word for how an applicant comes across, without giving the number away. */
export const impression = (quality: number): string => (quality >= 70 ? 'Experienced and well organised' : quality >= 50 ? 'Capable enough' : 'Keen but inexperienced');

export function acceptOffer(s: GameState, id: number): boolean {
  const offer = s.franchiseOffers.find((o) => o.id === id);
  const brand = offer && flagship(s, offer.type);
  if (!offer || !brand || rivalOnLot(s, offer.lotId) || s.lots[offer.lotId]) return false;
  s.franchiseOffers.splice(s.franchiseOffers.indexOf(offer), 1);
  earn(s, offer.fee, 'royalties');
  const n = s.franchises.filter((f) => f.type === offer.type).length + 1;
  s.franchises.push({ id: s.nextRivalShopId++, lotId: offer.lotId, type: offer.type, name: `${brand.name} (${offer.applicant.split(' ')[1]}'s)`, priceIndex: 1.02, quality: offer.quality, openedDay: dayOf(s.time), saleUntil: 0, today: 0, yesterday: 0, profitAvg: 0, owner: offer.applicant });
  news(s, `${offer.applicant} has opened franchise number ${n} of ${brand.name} and paid the ${money(offer.fee)} fee.`, 'good');
  bus.emit('stat', { stat: 'franchises' });
  bus.emit('rivals:changed');
  bus.emit('lot:changed', offer.lotId);
  return true;
}

export function declineOffer(s: GameState, id: number): void {
  s.franchiseOffers = s.franchiseOffers.filter((o) => o.id !== id);
  bus.emit('rivals:changed');
}

/** Pay for a visit from head office: standards go up. */
export function inspect(s: GameState, f: Franchise): boolean {
  if (!tryPay(s, F.inspectionCost, 'other')) return false;
  f.quality = clamp(f.quality + rand.range(8, 16), 0, 95);
  bus.emit('rivals:changed');
  return true;
}

export function revoke(s: GameState, f: Franchise): void {
  s.franchises.splice(s.franchises.indexOf(f), 1);
  news(s, `You withdrew the franchise from ${f.owner}. ${f.name} has closed.`, 'info');
  bus.emit('rivals:changed');
  bus.emit('lot:changed', f.lotId);
}

/** Yesterday's royalty from one franchise. */
export const royaltyOf = (f: Franchise): number => Math.round(f.profitAvg * 100) / 100;

/** Start of day: collect royalties, let standards drift, and let poor franchises drag the brand down. */
export function franchisesDaily(s: GameState): void {
  const day = dayOf(s.time);
  s.franchiseOffers = s.franchiseOffers.filter((o) => o.untilDay >= day);
  let total = 0;
  for (const f of [...s.franchises]) {
    const type = SHOP_TYPES[f.type];
    const visits = f.today + F.baseVisits * (f.quality / 50) * Math.min(1.5, type.demand * 8);
    const royalty = visits * ticket(f.type) * F.royalty;
    // profitAvg holds the smoothed royalty, which is what the owner (you) cares about.
    f.profitAvg = f.profitAvg ? f.profitAvg * 0.6 + royalty * 0.4 : royalty;
    f.yesterday = f.today;
    f.today = 0;
    total += royalty;
    // Left alone, standards slip.
    f.quality = clamp(f.quality + rand.range(-2.2, 1.2), 5, 95);
    const mine = s.shops.filter((sh) => sh.type === f.type);
    if (f.quality < 38) {
      for (const sh of mine) sh.reputation = clamp(sh.reputation - F.reputationDrag, 0, 100);
      if (day % 3 === 0 && mine.length) news(s, `Customers are complaining about ${f.name}. It is hurting the name of your own ${type.name.toLowerCase()}s. Send an inspector or withdraw the franchise.`, 'warn');
    } else if (f.quality > 72) for (const sh of mine) sh.reputation = clamp(sh.reputation + F.reputationDrag * 0.3, 0, 100);
    // The brand has to exist for there to be a franchise of it.
    if (!mine.length) {
      s.franchises.splice(s.franchises.indexOf(f), 1);
      news(s, `${f.name} has dropped your brand now that you no longer run a ${type.name.toLowerCase()} yourself.`, 'warn');
      bus.emit('lot:changed', f.lotId);
    }
  }
  if (total > 0) earn(s, Math.round(total * 100) / 100, 'royalties');
  maybeOffer(s);
  bus.emit('rivals:changed');
}
