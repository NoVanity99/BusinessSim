import type { GameState } from '../../core/state';
import type { ShopState } from '../../entities/Shop';
import { onDuty } from '../staff/staff';

/**
 * Multipliers that upgrades and staff apply to a shop. Kept in one place so new
 * upgrades only need a line here.
 */

/** Checkout speed. Upgrades (milestone 8) raise this. */
export function registerSpeedMult(s: GameState, shop: ShopState): number {
  return 1 + (s.upgrades?.[shop.id]?.fastRegisters ?? 0) * 0.25;
}

/** Chance multiplier for machines breaking. A mechanic on shift keeps things running. */
export function breakMult(s: GameState, shop: ShopState): number {
  const mechanic = s.staff.some((e) => e.shopId === shop.id && e.role === 'mechanic' && onDuty(s, e));
  return (mechanic ? 0.4 : 1) * (1 - (s.upgrades?.[shop.id]?.sturdyMachines ?? 0) * 0.3);
}
