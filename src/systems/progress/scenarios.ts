import { bus, toast } from '../../core/events';
import { money } from '../../core/format';
import { rand } from '../../core/rng';
import { session, type GameState } from '../../core/state';
import { PRODUCTS, SHOP_TYPES } from '../../data';
import scenariosJson from '../../data/scenarios.json';
import { batchQty } from '../../entities/Shop';
import { earn, spend } from '../economy/finance';
import { marketPrice } from '../economy/market';
import { netWorth } from '../economy/networth';
import { takeFromStorage } from '../economy/stock';
import { companyValue } from '../rivals/rivals';
import { dayOf } from '../time/clock';
import { addXp } from './level';

// ---------- Scenarios and sandbox ----------

export interface Goals {
  netWorth?: number;
  shops?: number;
  shopsOfType?: { type: string; count: number };
  served?: number;
  franchises?: number;
  topCompany?: boolean;
  noLoans?: boolean;
  staff?: number;
}

export interface Rules {
  noRivals?: boolean;
  noTax?: boolean;
  noBankruptcy?: boolean;
  aggressiveRivals?: boolean;
}

export interface ScenarioDef {
  id: string;
  name: string;
  description: string;
  difficulty: string;
  money: number;
  level: number;
  loan?: number;
  days: number;
  rules?: Rules;
  goals: Goals;
}

const DATA = scenariosJson as unknown as { scenarios: ScenarioDef[]; sandbox: { name: string; description: string; money: number; level: number; rules: Rules }; jobs: { clients: string[]; offerChance: number; maxOpen: number; priceMult: number; penaltyShare: number; xpPerDollar: number; minDay: number } };
export const SCENARIOS = DATA.scenarios;
export const SANDBOX = DATA.sandbox;
export const scenarioOf = (s: GameState): ScenarioDef | undefined => (s.scenario ? SCENARIOS.find((x) => x.id === s.scenario!.id) : undefined);
export const rulesOf = (s: GameState): Rules => s.rules ?? {};

/** Each goal with where the player stands, for the tracker. */
export function goalProgress(s: GameState, goals: Goals): { label: string; value: string; done: boolean }[] {
  const out: { label: string; value: string; done: boolean }[] = [];
  const worth = netWorth(s, session.city);
  if (goals.netWorth !== undefined) out.push({ label: `Net worth of ${money(goals.netWorth)}`, value: money(Math.round(worth)), done: worth >= goals.netWorth });
  if (goals.shops !== undefined) out.push({ label: `Run ${goals.shops} businesses`, value: `${s.shops.length}`, done: s.shops.length >= goals.shops });
  if (goals.shopsOfType) {
    const n = s.shops.filter((sh) => sh.type === goals.shopsOfType!.type).length;
    out.push({ label: `${goals.shopsOfType.count} × ${SHOP_TYPES[goals.shopsOfType.type].name}`, value: `${n}`, done: n >= goals.shopsOfType.count });
  }
  if (goals.served !== undefined) out.push({ label: `Serve ${goals.served.toLocaleString()} customers`, value: Math.round(s.stats.served ?? 0).toLocaleString(), done: (s.stats.served ?? 0) >= goals.served });
  if (goals.franchises !== undefined) out.push({ label: `${goals.franchises} franchises trading`, value: `${s.franchises.length}`, done: s.franchises.length >= goals.franchises });
  if (goals.staff !== undefined) out.push({ label: `Employ ${goals.staff} people`, value: `${s.staff.length}`, done: s.staff.length >= goals.staff });
  if (goals.noLoans) out.push({ label: 'Owe the bank nothing', value: s.loans.length ? money(Math.round(s.loans.reduce((a, l) => a + l.balance, 0))) : 'clear', done: s.loans.length === 0 });
  if (goals.topCompany) {
    const best = Math.max(0, ...s.rivals.map(companyValue));
    out.push({ label: 'Be worth more than every rival', value: `${money(Math.round(worth))} vs ${money(best)}`, done: s.shops.length > 0 && worth > best });
  }
  return out;
}

/** Once an hour: has the scenario been won, or has time run out? */
export function checkScenario(s: GameState): void {
  const def = scenarioOf(s);
  if (!def || !s.scenario || s.scenario.result) return;
  if (goalProgress(s, def.goals).every((g) => g.done)) {
    s.scenario.result = 'won';
    bus.emit('scenario:ended', true);
  } else if (dayOf(s.time) > s.scenario.deadlineDay) {
    s.scenario.result = 'lost';
    bus.emit('scenario:ended', false);
  }
}

// ---------- Delivery jobs ----------

/** A one-off order from an organisation in the city: so many of a product by a day, for a good price. */
export interface Job {
  id: number;
  client: string;
  product: string;
  qty: number;
  reward: number;
  deadlineDay: number;
  accepted: boolean;
}

const J = DATA.jobs;

/** Units of a product sitting in back rooms across the company. */
export const inAllStorage = (s: GameState, product: string): number => s.shops.reduce((a, sh) => a + batchQty(sh.storage[product]), 0);

function maybeOffer(s: GameState): void {
  const day = dayOf(s.time);
  if (day < J.minDay || s.jobs.filter((j) => !j.accepted).length >= J.maxOpen || !rand.chance(J.offerChance)) return;
  // Only things the company already deals in: goods and things it makes.
  const products = [...new Set(s.shops.flatMap((sh) => SHOP_TYPES[sh.type].products))].filter((p) => ['good', 'crafted'].includes(PRODUCTS[p].kind ?? 'good') && PRODUCTS[p].market > 0 && PRODUCTS[p].market < 200 && !s.jobs.some((j) => j.product === p));
  if (!products.length) return;
  const product = rand.pick(products);
  const d = PRODUCTS[product];
  const qty = d.caseSize * rand.int(2, 3 + Math.min(8, s.level));
  const job: Job = { id: s.nextJobId++, client: rand.pick(J.clients), product, qty, reward: Math.round((qty * marketPrice(s, product) * J.priceMult) / 10) * 10, deadlineDay: day + rand.int(2, 4), accepted: false };
  s.jobs.push(job);
  toast(`${job.client} wants ${qty} ${d.name.toLowerCase()} by day ${job.deadlineDay} for ${money(job.reward)}. See the Company window.`, 'info');
}

export function acceptJob(s: GameState, id: number): void {
  const job = s.jobs.find((j) => j.id === id);
  if (!job) return;
  job.accepted = true;
  bus.emit('jobs:changed');
}

export function declineJob(s: GameState, id: number): void {
  s.jobs = s.jobs.filter((j) => j.id !== id || j.accepted);
  bus.emit('jobs:changed');
}

/** Hand over the goods from the back rooms and get paid. */
export function deliverJob(s: GameState, id: number): boolean {
  const job = s.jobs.find((j) => j.id === id);
  if (!job || !job.accepted || inAllStorage(s, job.product) < job.qty) return false;
  let left = job.qty;
  for (const shop of s.shops) {
    if (left <= 0) break;
    const taken = takeFromStorage(shop, job.product, left);
    left -= taken;
    if (taken) bus.emit('stock:changed', shop.id);
  }
  earn(s, job.reward, 'sales');
  addXp(s, job.reward * J.xpPerDollar);
  s.jobs.splice(s.jobs.indexOf(job), 1);
  bus.emit('stat', { stat: 'jobs' });
  toast(`Delivered ${job.qty} ${PRODUCTS[job.product].name.toLowerCase()} to ${job.client}. ${money(job.reward)} paid.`, 'good');
  bus.emit('jobs:changed');
  return true;
}

/** Start of day: missed deadlines cost a penalty; stale offers lapse; a new one may arrive. */
export function jobsDaily(s: GameState): void {
  const day = dayOf(s.time);
  for (const job of [...s.jobs]) {
    if (job.deadlineDay >= day) continue;
    s.jobs.splice(s.jobs.indexOf(job), 1);
    if (!job.accepted) continue;
    const penalty = Math.round(job.reward * J.penaltyShare);
    spend(s, penalty, 'fines');
    toast(`You missed ${job.client}'s order for ${PRODUCTS[job.product].name.toLowerCase()}. They charged a ${money(penalty)} penalty.`, 'bad');
  }
  maybeOffer(s);
  bus.emit('jobs:changed');
}
