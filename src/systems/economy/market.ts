import { bus } from '../../core/events';
import { clamp } from '../../core/format';
import { rand } from '../../core/rng';
import type { GameState } from '../../core/state';
import { DIFFICULTIES, ECONOMY, PRODUCTS } from '../../data';

/** Price multiplier per product; drifts a little every day. */
export interface MarketState {
  mult: Record<string, number>;
  /** Yesterday's multipliers, for trend arrows. */
  prev: Record<string, number>;
}

export function newMarketState(): MarketState {
  const mult: Record<string, number> = {};
  for (const id of Object.keys(PRODUCTS)) mult[id] = 1;
  return { mult, prev: { ...mult } };
}

const multOf = (s: GameState, product: string): number => s.market.mult[product] ?? 1;

/** What the wholesaler charges per unit right now. */
export function wholesalePrice(s: GameState, product: string): number {
  return PRODUCTS[product].wholesale * multOf(s, product) * DIFFICULTIES[s.difficulty].costMult;
}

/** The retail price customers consider normal right now. */
export function marketPrice(s: GameState, product: string): number {
  return PRODUCTS[product].market * multOf(s, product);
}

export function trendOf(s: GameState, product: string): number {
  return multOf(s, product) - (s.market.prev[product] ?? 1);
}

export const roundPrice = (p: number): number => Math.max(0.05, Math.round(p * 20) / 20);

/** Random walk with a gentle pull back toward 1.0. */
export function driftMarket(s: GameState): void {
  const { driftPerDay, minMult, maxMult } = ECONOMY.market;
  s.market.prev = { ...s.market.mult };
  for (const id of Object.keys(PRODUCTS)) {
    const cur = multOf(s, id);
    const pull = (1 - cur) * 0.08;
    s.market.mult[id] = clamp(cur + rand.range(-driftPerDay, driftPerDay) + pull, minMult, maxMult);
  }
  bus.emit('market:changed');
}
