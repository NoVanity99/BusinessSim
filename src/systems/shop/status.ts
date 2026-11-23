import type { GameState } from '../../core/state';
import { defOf, type PlacedObject, type ShopState } from '../../entities/Shop';
import { hourFloat } from '../time/clock';
import { DIFFICULTIES, ECONOMY } from '../../data';
import { cashierAt } from '../staff/agents';
import { performance } from '../staff/staff';
import { ownerSpeed } from '../player/player';

/** Within opening hours and not closed by the player. */
export function isOpenNow(s: GameState, shop: ShopState): boolean {
  if (shop.closed || (shop.closedUntil ?? 0) > s.time.minutes) return false;
  const h = hourFloat(s.time);
  const [from, to] = shop.hours;
  return from < to ? h >= from && h < to : h >= from || h < to;
}

/** How fast a station is being worked: 0 = unattended, 1 = an average worker. */
export function operatorSpeed(s: GameState, shop: ShopState, obj: PlacedObject): number {
  if (defOf(obj).kind !== 'register') return 0;
  if (s.ownerAt?.shopId === shop.id && s.ownerAt.objectId === obj.id) return ownerSpeed(s);
  const cashier = cashierAt(s, shop.id, obj.id);
  if (cashier) return performance(cashier);
  // Self-checkout keeps unattended tills working, slowly.
  return (s.upgrades[shop.id]?.selfCheckout ?? 0) > 0 ? 0.55 : 0;
}

/** Daily utility bill for one shop: a base charge, floor area, and powered equipment. */
export function utilityCost(s: GameState, shop: ShopState): number {
  const u = ECONOMY.utilities;
  let power = 0;
  for (const o of shop.objects) power += defOf(o).power ?? 0;
  const area = shop.floor.filter(Boolean).length;
  const saving = 1 - (s.upgrades[shop.id]?.efficientEnergy ?? 0) * 0.2;
  return Math.round((u.basePerDay + area * u.perTilePerDay + power * u.perPowerUnitPerDay * saving) * DIFFICULTIES[s.difficulty].costMult);
}

/** Price of a one-off professional clean, scaled by shop size. */
export function deepCleanCost(shop: ShopState): number {
  return 20 + Math.round(shop.floor.filter(Boolean).length * 0.5);
}
