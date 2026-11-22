import { bus, toast } from '../../core/events';
import { clamp, money } from '../../core/format';
import { rand } from '../../core/rng';
import { shopById, type GameState } from '../../core/state';
import { EMPLOYEES, POPULATION, type TraitDef } from '../../data';
import { inShift, shiftLength, type Candidate, type Employee } from '../../entities/Employee';
import { spend, tryPay } from '../economy/finance';
import { dayOf, hourOf } from '../time/clock';

type NumericTrait = 'speed' | 'friendliness' | 'reliability' | 'wageMult' | 'energyDrain' | 'moraleBase' | 'carry' | 'learn' | 'theft';

/** Sum (or product, for multipliers) of a modifier across someone's traits. */
export function traitSum(p: { traits: string[] }, key: NumericTrait): number {
  const multiplicative = key === 'wageMult' || key === 'energyDrain' || key === 'carry';
  let v = multiplicative ? 1 : 0;
  for (const t of p.traits) {
    const x = EMPLOYEES.traits[t]?.[key];
    if (x === undefined) continue;
    v = multiplicative ? v * x : v + x;
  }
  return v;
}

export const hasTrait = (p: { traits: string[] }, flag: keyof TraitDef): boolean => p.traits.some((t) => !!EMPLOYEES.traits[t]?.[flag]);

/** Skill including trait bonuses, clamped to 1-10. */
export function skill(p: Candidate, key: 'speed' | 'friendliness' | 'reliability'): number {
  return clamp(p.skills[key] + traitSum(p, key), 1, 10);
}

/** What the market would pay for these skills and traits. */
function marketWage(c: Pick<Candidate, 'role' | 'skills' | 'traits'>): number {
  const avg = (c.skills.speed + c.skills.friendliness + c.skills.reliability) / 3;
  return EMPLOYEES.roles[c.role].wage * (0.7 + avg * 0.06) * traitSum(c, 'wageMult');
}

export function generateCandidate(s: GameState, role?: string): Candidate {
  const roles = Object.keys(EMPLOYEES.roles);
  const traitIds = Object.keys(EMPLOYEES.traits);
  const rollSkill = (): number => clamp(Math.round(rand.range(1, 7) + rand.range(0, 4)), 1, 10);
  const traits: string[] = [];
  const count = rand.pick([0, 1, 1, 1, 2]);
  while (traits.length < count) {
    const t = rand.pick(traitIds);
    if (!traits.includes(t)) traits.push(t);
  }
  const c: Candidate = {
    id: s.nextPersonId++,
    name: `${rand.pick(POPULATION.firstNames)} ${rand.pick(POPULATION.lastNames)}`,
    role: role ?? rand.pick(roles),
    skills: { speed: rollSkill(), friendliness: rollSkill(), reliability: rollSkill() },
    traits,
    wage: 0,
    look: rand.int(0, 23),
  };
  // Asking wage wobbles around the market rate: some people undersell themselves.
  c.wage = Math.round(marketWage(c) * rand.range(0.92, 1.1) * 4) / 4;
  return c;
}

/** Replace part of the pool each day so there is always someone new to consider. */
export function refreshCandidates(s: GameState, replaceShare = 0.5): void {
  s.candidates = s.candidates.filter(() => !rand.chance(replaceShare));
  const roles = Object.keys(EMPLOYEES.roles);
  while (s.candidates.length < EMPLOYEES.candidatePoolSize) {
    // Guarantee at least one cashier and one stocker are on offer.
    const missing = ['cashier', 'stocker'].find((r) => !s.candidates.some((c) => c.role === r));
    s.candidates.push(generateCandidate(s, missing ?? rand.pick(roles)));
  }
  bus.emit('staff:changed');
}

export function hire(s: GameState, candidateId: number, shopId: number): Employee | null {
  const i = s.candidates.findIndex((c) => c.id === candidateId);
  const shop = shopById(s, shopId);
  if (i < 0 || !shop) return null;
  if (!tryPay(s, EMPLOYEES.hiringFee, 'wages')) {
    toast(`You need ${money(EMPLOYEES.hiringFee)} to cover the hiring paperwork.`, 'bad');
    return null;
  }
  const c = s.candidates.splice(i, 1)[0];
  const from = clamp(shop.hours[0], 0, 23);
  const e: Employee = {
    ...c,
    shopId,
    stationId: null,
    shift: [from, Math.min(shop.hours[1], from + 8) % 24 || 24],
    energy: 100,
    morale: 65,
    fairWage: marketWage(c),
    hoursWorked: 0,
    absentDay: 0,
    hiredDay: dayOf(s.time),
  };
  s.staff.push(e);
  toast(`${e.name} hired as ${EMPLOYEES.roles[e.role].name.toLowerCase()} at ${shop.name}.`, 'good');
  bus.emit('staff:changed');
  return e;
}

export function fire(s: GameState, id: number, quit = false): void {
  const i = s.staff.findIndex((e) => e.id === id);
  if (i < 0) return;
  const [e] = s.staff.splice(i, 1);
  if (!quit) toast(`${e.name} was let go.`, 'info');
  bus.emit('staff:removed', id);
  bus.emit('staff:changed');
}

export function staffOf(s: GameState, shopId: number): Employee[] {
  return s.staff.filter((e) => e.shopId === shopId);
}

/** Scheduled to be at work this hour and not off sick. */
export function onDuty(s: GameState, e: Employee): boolean {
  return e.shopId !== null && e.absentDay !== dayOf(s.time) && inShift(e.shift, hourOf(s.time));
}

/** Work-rate multiplier: about 1.0 for an average, rested, content worker. */
export function performance(e: Employee): number {
  const base = 0.55 + skill(e, 'speed') * 0.09;
  const energy = e.energy > 40 ? 1 : 0.6 + 0.4 * (e.energy / 40);
  const morale = 0.8 + 0.3 * (e.morale / 100);
  return base * energy * morale;
}

export function hourlyCost(e: Employee, hourIntoShift: number): number {
  return e.wage * (hourIntoShift >= EMPLOYEES.overtimeAfterHours ? EMPLOYEES.overtimeMult : 1);
}

export function dailyWageBill(e: Employee): number {
  const len = shiftLength(e.shift);
  const normal = Math.min(len, EMPLOYEES.overtimeAfterHours);
  return e.wage * (normal + (len - normal) * EMPLOYEES.overtimeMult);
}

export function giveRaise(e: Employee, amount: number): void {
  e.wage = Math.round((e.wage + amount) * 4) / 4;
  e.morale = clamp(e.morale + 10, 0, 100);
  bus.emit('staff:changed');
}

export function giveBonus(s: GameState, e: Employee, amount: number): boolean {
  if (!tryPay(s, amount, 'wages')) return false;
  e.morale = clamp(e.morale + 18, 0, 100);
  bus.emit('staff:changed');
  return true;
}

/** Wages, energy and morale. Call at the top of every game hour. */
export function staffHourly(s: GameState): void {
  const hour = hourOf(s.time);
  const today = dayOf(s.time);
  for (const e of s.staff) {
    const shop = e.shopId !== null ? shopById(s, e.shopId) : undefined;
    if (!shop) continue;
    const scheduled = inShift(e.shift, hour);
    const startsNow = hour === e.shift[0] % 24;

    if (startsNow && e.absentDay !== today) {
      // Unreliable or miserable people sometimes do not show up.
      const p = (10 - skill(e, 'reliability')) * 0.012 + (e.morale < 30 ? 0.1 : 0);
      if (rand.chance(p)) {
        e.absentDay = today;
        toast(`${e.name} called in sick. ${shop.name} is short-staffed today.`, 'warn');
      }
    }

    if (scheduled && e.absentDay !== today) {
      const into = (hour - e.shift[0] + 24) % 24;
      spend(s, hourlyCost(e, into), 'wages');
      e.hoursWorked++;
      const late = hour >= 22 || hour < 6;
      const drain = 9 * traitSum(e, 'energyDrain') * (late && !hasTrait(e, 'nightOwl') ? 1.4 : 1) * (into >= EMPLOYEES.overtimeAfterHours ? 1.5 : 1);
      e.energy = clamp(e.energy - drain, 0, 100);
      // Experience: a skill point every so often, faster for quick learners.
      const every = Math.round(60 / (1 + traitSum(e, 'learn')));
      if (e.hoursWorked % every === 0 && e.skills.speed < 10) {
        e.skills.speed++;
        toast(`${e.name} is getting better at the job (speed ${e.skills.speed}).`, 'good');
      }
    } else {
      e.energy = clamp(e.energy + 11, 0, 100);
    }

    // Morale drifts toward a level set by pay, hours and working conditions.
    const hasManager = s.staff.some((m) => m.shopId === e.shopId && m.role === 'manager' && m.id !== e.id && onDuty(s, m));
    const target = clamp(
      58 + (e.wage / e.fairWage - 1) * 130 - Math.max(0, shiftLength(e.shift) - EMPLOYEES.overtimeAfterHours) * 7 + traitSum(e, 'moraleBase') + (hasManager ? 7 : 0) - (shop.dirt > 60 ? 6 : 0) - (e.energy < 25 ? 8 : 0),
      5,
      98,
    );
    e.morale += clamp(target - e.morale, -1.5, 1.5);
  }
  bus.emit('staff:changed');
}

/** End-of-day: unhappy staff may quit. */
export function staffDaily(s: GameState): void {
  for (const e of [...s.staff]) {
    if (e.morale < 18 && !hasTrait(e, 'noQuit') && rand.chance(0.4)) {
      toast(`${e.name} quit. They were miserable.`, 'bad');
      fire(s, e.id, true);
    }
  }
  refreshCandidates(s);
}
