import { bus, toast } from '../../core/events';
import { clamp, money } from '../../core/format';
import { type GameState } from '../../core/state';
import { CORPORATE } from '../../data';
import type { ShopState } from '../../entities/Shop';
import { earn, spend, tryPay } from '../economy/finance';
import { dayOf } from '../time/clock';

const P = CORPORATE.player;

/**
 * The owner as a person: where they live, what they drive and how much energy they
 * have. Working a till wears you out; a better home gets you back on your feet faster,
 * and a car lets you look in on more of your shops in a day.
 */
export interface PlayerState {
  energy: number;
  home: string;
  car: string;
  /** Shops visited in person today (ids), and the day that list is for. */
  visited: number[];
  visitDay: number;
}

export const newPlayer = (): PlayerState => ({ energy: 100, home: 'studio', car: 'none', visited: [], visitDay: 0 });

export const homeOf = (s: GameState): (typeof P.homes)[keyof typeof P.homes] => P.homes[s.player.home as keyof typeof P.homes] ?? P.homes.studio;
export const carOf = (s: GameState): (typeof P.cars)[keyof typeof P.cars] => P.cars[s.player.car as keyof typeof P.cars] ?? P.cars.none;

/** How fast the owner works a till: slower when worn out. */
export const ownerSpeed = (s: GameState): number => (s.player.energy < P.tiredBelow ? P.tiredSpeed : 1);
export const isTired = (s: GameState): boolean => s.player.energy < P.tiredBelow;

/** Once a game hour: energy drains at the till and comes back otherwise. */
export function playerHourly(s: GameState): void {
  const home = homeOf(s);
  const was = s.player.energy;
  if (s.ownerAt) s.player.energy = clamp(was - P.drainPerHourAtTill, 0, home.maxEnergy);
  else s.player.energy = clamp(was + home.restPerHour, 0, home.maxEnergy);
  if (s.ownerAt && was >= P.tiredBelow && s.player.energy < P.tiredBelow) toast('You are worn out and working slowly. Step away from the till to rest, or hire a cashier.', 'warn');
  if (s.ownerAt && s.player.energy <= 0) {
    s.ownerAt = null;
    toast('You are exhausted and have gone home to rest. Your till is unattended.', 'bad');
    bus.emit('staff:changed');
  }
  bus.emit('player:changed');
}

/** Start of day: the cost of living, and a fresh round of visits. */
export function playerDaily(s: GameState): void {
  spend(s, homeOf(s).costPerDay + carOf(s).costPerDay, 'living');
  s.player.visited = [];
  s.player.visitDay = dayOf(s.time);
  bus.emit('player:changed');
}

export function moveHome(s: GameState, id: string): boolean {
  const next = P.homes[id as keyof typeof P.homes];
  if (!next || id === s.player.home) return false;
  const refund = homeOf(s).deposit;
  if (next.deposit > refund && !tryPay(s, next.deposit - refund, 'living')) {
    toast(`You need ${money(next.deposit - refund)} for the deposit.`, 'bad');
    return false;
  }
  if (refund > next.deposit) earn(s, refund - next.deposit, 'refund');
  s.player.home = id;
  toast(`You have moved into the ${next.name.toLowerCase()}.`, 'good');
  bus.emit('player:changed');
  return true;
}

export function buyCar(s: GameState, id: string): boolean {
  const next = P.cars[id as keyof typeof P.cars];
  if (!next || id === s.player.car) return false;
  // The old car goes in part exchange for half what it cost.
  const tradeIn = Math.round(carOf(s).price * 0.5);
  const cost = next.price - tradeIn;
  if (cost > 0 && !tryPay(s, cost, 'living')) {
    toast(`You need ${money(cost)} for the ${next.name.toLowerCase()}.`, 'bad');
    return false;
  }
  if (cost < 0) earn(s, -cost, 'refund');
  s.player.car = id;
  toast(next.price ? `The ${next.name.toLowerCase()} is yours.` : 'You sold the car.', 'good');
  bus.emit('player:changed');
  return true;
}

export const visitsLeft = (s: GameState): number => Math.max(0, carOf(s).visitsPerDay - (s.player.visitDay === dayOf(s.time) ? s.player.visited.length : 0));

/** Why the owner cannot call in on a shop right now, or null if they can. */
export function visitProblem(s: GameState, shop: ShopState): string | null {
  if (s.player.visitDay === dayOf(s.time) && s.player.visited.includes(shop.id)) return 'You have already been in today';
  if (visitsLeft(s) <= 0) return carOf(s).price ? 'No time for more visits today' : 'No time for more visits today on foot';
  if (s.player.energy < carOf(s).visitEnergy + 5) return 'You are too tired';
  return null;
}

/** Call in on a shop: the staff perk up, things get tidied, and you see it for yourself. */
export function visitShop(s: GameState, shop: ShopState): boolean {
  if (visitProblem(s, shop)) return false;
  if (s.player.visitDay !== dayOf(s.time)) {
    s.player.visited = [];
    s.player.visitDay = dayOf(s.time);
  }
  s.player.visited.push(shop.id);
  s.player.energy = clamp(s.player.energy - carOf(s).visitEnergy, 0, homeOf(s).maxEnergy);
  for (const e of s.staff) if (e.shopId === shop.id) e.morale = clamp(e.morale + P.visitMoraleBoost, 0, 100);
  shop.dirt = clamp(shop.dirt - P.visitDirtCut, 0, 100);
  shop.reputation = clamp(shop.reputation + 0.5, 0, 100);
  toast(`You called in at ${shop.name}. The staff are glad to see the boss taking an interest.`, 'good');
  bus.emit('staff:changed');
  bus.emit('player:changed');
  return true;
}
