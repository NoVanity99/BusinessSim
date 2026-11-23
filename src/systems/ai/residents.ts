import { LOOK_COUNT } from '../../art/looks';
import { FURNITURE } from '../../data';
import { couponCut, loyaltyBoost } from '../marketing/marketing';
import { allRivalShops, rivalOpenNow, rivalUtility, type RivalShop } from '../rivals/rivals';
import { regKey, rt } from './runtime';
import { bus } from '../../core/events';
import { clamp } from '../../core/format';
import { rand } from '../../core/rng';
import { session, shopById, type GameState } from '../../core/state';
import { PERSONAS, POPULATION, SHOP_TYPES, type PersonaDef } from '../../data';
import type { Customer } from '../../entities/Customer';
import type { ShopState } from '../../entities/Shop';
import { shopDemandMult } from '../events/events';
import { fairPrice } from '../shop/pricing';
import { isOpenNow } from '../shop/status';
import { dayOf, hourOf } from '../time/clock';
import { weatherDemand } from '../world/weather';

/** What a resident remembers about one shop. */
export interface ShopMemory {
  /** Times they have been in. Zero means they have only heard about it. */
  visits: number;
  /** -1 (never again) to 1 (favourite), weighted toward recent visits. */
  score: number;
  lastDay: number;
}

/**
 * Someone who lives in the city. Residents persist between days and saves, which is what
 * lets them build habits: needs that grow until met, opinions of your shops, and loyalty.
 */
export interface Resident {
  id: number;
  name: string;
  look: number;
  persona: string;
  /** Map tile they set out from and return to. */
  home: number;
  wealth: number;
  /** Game minute each need was last met, keyed by need id. */
  met: Record<string, number>;
  memory: Record<number, ShopMemory>;
}

export interface Review {
  day: number;
  stars: number;
  text: string;
  author: string;
  persona: string;
}

export const MAX_REVIEWS = 40;
export const personaOf = (id: string): PersonaDef => PERSONAS.personas[id] ?? PERSONAS.personas.regular;

/** Pick a persona by its share of the population. */
function rollPersona(): string {
  const entries = Object.entries(PERSONAS.personas).filter(([, p]) => p.share > 0);
  let r = rand.next() * entries.reduce((a, [, p]) => a + p.share, 0);
  for (const [id, p] of entries) if ((r -= p.share) <= 0) return id;
  return entries[0][0];
}

/** Populate the city. Homes are drawn from the same places pedestrians already appear. */
export function generateResidents(s: GameState, homes: { tile: number; weight: number; wealth: number }[]): void {
  s.residents = [];
  const total = homes.reduce((a, h) => a + h.weight, 0);
  for (let i = 0; i < PERSONAS.residents; i++) {
    let r = rand.next() * total;
    const home = homes.find((h) => (r -= h.weight) <= 0) ?? homes[0];
    const met: Record<string, number> = {};
    // Stagger everyone so the whole city does not get hungry at the same minute.
    for (const [need, def] of Object.entries(PERSONAS.needs)) met[need] = s.time.minutes - rand.range(0, def.hours * 60 * 1.5);
    s.residents.push({
      id: s.nextPersonId++,
      name: `${rand.pick(POPULATION.firstNames)} ${rand.pick(POPULATION.lastNames)}`,
      look: rand.int(0, LOOK_COUNT - 1),
      persona: rollPersona(),
      home: home.tile,
      wealth: home.wealth,
      met,
      memory: {},
    });
  }
}

/** How pressing a need is: 0.15 just after it was met, 1 at its usual interval, up to 2 when overdue. */
export function needLevel(s: GameState, r: Resident, need: string): number {
  const def = PERSONAS.needs[need];
  const rate = personaOf(r.persona).needs[need] ?? 1;
  const hours = (s.time.minutes - (r.met[need] ?? 0)) / 60;
  return clamp((hours / def.hours) * rate, 0.15, 2);
}

const needsServedBy = (type: string): [string, number][] =>
  Object.entries(PERSONAS.needs)
    .filter(([, d]) => d.types[type])
    .map(([id, d]) => [id, d.types[type]]);

/**
 * How much this person wants this kind of business right now, relative to an average
 * person at an average hour (1.0). Combines their strongest relevant need, the time of
 * day and what the weather is doing to demand.
 */
export function appetite(s: GameState, r: Resident | null, persona: string, type: string): number {
  const hour = hourOf(s.time);
  let best = 0;
  for (const [need, fit] of needsServedBy(type)) {
    const def = PERSONAS.needs[need];
    const level = r ? needLevel(s, r, need) : personaOf(persona).needs[need] ?? 1;
    best = Math.max(best, level * fit * def.curve[hour]);
  }
  // Businesses no need maps to (none today) are wanted at a flat rate.
  if (!needsServedBy(type).length) best = 1;
  return best * weatherDemand(s, type) * (rt.demandMult[type] ?? 1);
}

/** Decide what kind of business, if any, this outing is for. */
export function chooseNeed(s: GameState, r: Resident | null, persona: string): string | null {
  // Each type's share of footfall is the baseline; appetite scales it for this person, now.
  let total = 0;
  const scores: [string, number][] = [];
  for (const [id, t] of Object.entries(SHOP_TYPES)) {
    if (t.demand <= 0) continue;
    const score = t.demand * appetite(s, r, persona, id);
    scores.push([id, score]);
    total += score;
  }
  // The rest of the time people are simply going somewhere.
  const none = Math.max(0.05, 1 - Object.values(SHOP_TYPES).reduce((a, t) => a + t.demand, 0));
  let roll = rand.next() * (total + none);
  for (const [id, score] of scores) if ((roll -= score) <= 0) return id;
  return null;
}

/** Average of price / fair price over what a shop sells: 1.0 means priced at market. */
export function priceIndex(s: GameState, shop: ShopState): number {
  let sum = 0;
  let n = 0;
  for (const p of SHOP_TYPES[shop.type].products) {
    if (shop.prices[p] === undefined) continue;
    sum += shop.prices[p] / fairPrice(s, shop, p);
    n++;
  }
  return n ? (sum / n) * (1 - couponCut(s, shop)) : 1;
}

export const shopRating = (shop: ShopState): number => (shop.reviews.length ? shop.reviews.reduce((a, r) => a + r.stars, 0) / shop.reviews.length : 0);

/** How attractive one of the player's shops is to this person, in utility units. */
export function shopUtility(s: GameState, r: Resident | null, persona: string, shop: ShopState, fromTile: number): number {
  const p = personaOf(persona);
  const { city } = session;
  const lot = city.lots[shop.lotId];
  const fx = fromTile % city.w;
  const fy = Math.floor(fromTile / city.w);
  const distance = Math.hypot(lot.x + lot.w / 2 - fx, lot.y + lot.h / 2 - fy) / Math.hypot(city.w, city.h);
  const mem = r?.memory[shop.id];
  const rating = shopRating(shop);
  let u = 1;
  u += ((shop.reputation - 50) / 50) * 0.9;
  if (rating) u += ((rating - 3) / 2) * 0.5;
  u -= distance * 2.2 * (1 - (SHOP_TYPES[shop.type].destination ?? 0));
  u -= (priceIndex(s, shop) - 1) * 3 * p.priceSense;
  u += (shopDemandMult(s, shop) - 1) * 1.5;
  if (mem) {
    const scheme = loyaltyBoost(s, shop);
    u += mem.score * 1.3 * p.loyalty * scheme;
    if (isRegular(mem)) u += 0.7 * p.loyalty * scheme;
    // Once badly let down, most people do not come back.
    if (mem.score < -0.5) u -= 2;
  }
  if (shop.eventDay === dayOf(s.time)) u += 1.5;
  return u;
}

/**
 * Whether a business that works by appointment with its equipment (a hotel's rooms, a cinema's
 * seats, a laundromat's washers) has a place free. People can see a "full" sign from the street.
 */
export function hasRoom(shop: ShopState): boolean {
  const type = SHOP_TYPES[shop.type];
  const first = type.flow === 'service' && !type.planFree ? type.plan?.[0] : undefined;
  if (!first) return true;
  const stations = shop.objects.filter((o) => FURNITURE[o.def].kind === 'service' && FURNITURE[o.def].service === first && !o.broken);
  // Nothing built yet is the owner's problem, not a full house.
  if (!stations.length) return true;
  // One party may be on its way already; leave a little slack rather than turning everyone back at the door.
  return stations.some((o) => (rt.stations.get(regKey(shop.id, o.id))?.length ?? 0) < (FURNITURE[o.def].capacity ?? 1));
}

export const isRegular = (m: ShopMemory | undefined): boolean => !!m && m.visits >= 3 && m.score > 0.4;

/**
 * Having decided what kind of place they want, choose between the player's shops of that
 * kind, rival companies' shops, and somewhere else in town.
 */
export function chooseShop(s: GameState, r: Resident | null, persona: string, type: string, fromTile: number): { shop?: ShopState; rival?: RivalShop } {
  const mine = s.shops.filter((sh) => sh.type === type && isOpenNow(s, sh) && hasRoom(sh));
  // Franchises of the player's brands are places to go too; custom there earns a royalty.
  const theirs = rivalOpenNow(s) ? [...allRivalShops(s), ...s.franchises].filter((sh) => sh.type === type) : [];
  if (!mine.length && !theirs.length) return {};
  const TEMPERATURE = 0.6;
  const sense = personaOf(persona).priceSense;
  const weights = [
    ...mine.map((sh) => Math.exp(shopUtility(s, r, persona, sh, fromTile) / TEMPERATURE)),
    ...theirs.map((sh) => Math.exp(rivalUtility(s, sh, sense, fromTile) / TEMPERATURE)),
    // "Elsewhere" stands for every other business in the city: always available, never special.
    Math.exp(1 / TEMPERATURE),
  ];
  let roll = rand.next() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < mine.length; i++) if ((roll -= weights[i]) <= 0) return { shop: mine[i] };
  for (let i = 0; i < theirs.length; i++) if ((roll -= weights[mine.length + i]) <= 0) return { rival: theirs[i] };
  return {};
}

const REVIEW_TEXT: { test: RegExp; stars: [number, number]; lines: string[] }[] = [
  { test: /expensive|rip-off|afford/i, stars: [1, 2], lines: ['Daylight robbery.', 'Way overpriced for what it is.', 'Nice enough but my wallet is crying.'] },
  // Not stocking something is a let-down, not a disaster: it caps the score rather than sinking it.
  { test: /out of|sold out|can't find|run out/i, stars: [2, 4], lines: ['Decent, but they did not have everything.', 'Small range. Fine for the basics.', 'Went in for one thing. They did not have it.'] },
  { test: /waited|forever|queue|ages|nobody|where's my/i, stars: [1, 2], lines: ['Waited an age and gave up.', 'Understaffed. The line did not move.', 'Bring a book, you will be queuing a while.'] },
  { test: /filthy|rude|out of order|taken/i, stars: [1, 2], lines: ['Grubby and unloved.', 'Staff could not care less.', 'Half the machines were broken.'] },
  { test: /bargain|good prices/i, stars: [4, 5], lines: ['Cheapest around, no contest.', 'Great prices. Stocked up.', 'Honest prices, friendly place.'] },
  { test: /great service|quick|got everything|smells great/i, stars: [4, 5], lines: ['In and out in a minute. Perfect.', 'Lovely staff, had everything I needed.', 'My new regular spot.'] },
  { test: /amazing|again|best ride/i, stars: [5, 5], lines: ['The kids did not want to leave.', 'Best afternoon in ages.', 'Worth every penny.'] },
];

function writeReview(s: GameState, shop: ShopState, c: Customer, persona: string): void {
  const last = [...c.thoughts].reverse().find((t) => t.kind !== 'neutral');
  const match = last && REVIEW_TEXT.find((t) => t.test.test(last.text));
  // Mood sets the stars; the last strong impression sets the words and nudges the score.
  let stars = clamp(Math.round(c.mood / 20), 1, 5);
  if (match) stars = clamp(stars, match.stars[0], match.stars[1]);
  const text = match ? rand.pick(match.lines) : stars >= 4 ? rand.pick(['Does the job nicely.', 'Would come again.', 'Solid.']) : stars <= 2 ? rand.pick(['Would not rush back.', 'Disappointing.']) : rand.pick(['It was fine.', 'Nothing special.']);
  shop.reviews.unshift({ day: dayOf(s.time), stars, text, author: c.name, persona });
  if (shop.reviews.length > MAX_REVIEWS) shop.reviews.pop();
  bus.emit('review:posted', { shopId: shop.id, stars, text });
}

/**
 * Called when someone leaves one of the player's shops. Updates what they remember,
 * may produce a review, and lets them tell a few acquaintances.
 */
export function afterVisit(s: GameState, shop: ShopState, c: Customer): void {
  const r = c.residentId >= 0 ? s.residents.find((x) => x.id === c.residentId) : null;
  // -1 for a wretched visit, +1 for a delightful one.
  const feeling = clamp((c.mood - 50) / 40, -1, 1);
  if (r) {
    const m = (r.memory[shop.id] ??= { visits: 0, score: 0, lastDay: 0 });
    const wasRegular = isRegular(m);
    m.visits++;
    // Recent visits count for more than old ones; a first impression counts in full.
    m.score = m.visits === 1 ? feeling : clamp(m.score * 0.6 + feeling * 0.4, -1, 1);
    // A loyalty card makes a good visit count for more.
    if (feeling > 0) m.score = clamp(m.score + 0.08 * (loyaltyBoost(s, shop) - 1) * 2, -1, 1);
    m.lastDay = dayOf(s.time);
    if (!wasRegular && isRegular(m)) bus.emit('regular:gained', { shopId: shop.id, name: r.name });
    // Their need is met if they actually got something.
    if (c.bought) for (const [need] of needsServedBy(shop.type)) r.met[need] = s.time.minutes;

    // Word of mouth: strong feelings get passed on to a couple of people they know.
    if (Math.abs(feeling) > 0.5) {
      for (let i = 0; i < 2; i++) {
        const friend = rand.pick(s.residents);
        if (friend.id === r.id) continue;
        const fm = (friend.memory[shop.id] ??= { visits: 0, score: 0, lastDay: 0 });
        fm.score = clamp(fm.score + feeling * 0.25 * personaOf(friend.persona).loyalty, -1, 1);
      }
    }
  }
  // People with strong opinions post them; tourists are especially keen.
  const chance = 0.05 + Math.abs(feeling) * 0.16 + (c.persona === 'tourist' ? 0.08 : 0);
  if (c.entered && rand.chance(chance)) writeReview(s, shop, c, c.persona);
}

/** Someone who went elsewhere still got what they needed; their needs reset too. */
export function metElsewhere(s: GameState, residentId: number, type: string | null): void {
  if (!type || residentId < 0) return;
  const r = s.residents.find((x) => x.id === residentId);
  if (r) for (const [need] of needsServedBy(type)) r.met[need] = s.time.minutes;
}

/** Forget shops that no longer exist, so memories do not grow without bound. */
export function pruneMemories(s: GameState): void {
  for (const r of s.residents) for (const id of Object.keys(r.memory)) if (!shopById(s, +id)) delete r.memory[+id];
}

/** Regular customers of a shop, for the dashboard. */
export const regularsOf = (s: GameState, shopId: number): number => s.residents.reduce((a, r) => a + (isRegular(r.memory[shopId]) ? 1 : 0), 0);
