import type { GameState } from '../../core/state';
import { defOf, type PlacedObject, type ShopState } from '../../entities/Shop';
import { hourFloat } from '../time/clock';

/** Within opening hours and not closed by the player. */
export function isOpenNow(s: GameState, shop: ShopState): boolean {
  if (shop.closed) return false;
  const h = hourFloat(s.time);
  const [from, to] = shop.hours;
  return from < to ? h >= from && h < to : h >= from || h < to;
}

/**
 * How fast a station is being worked: 0 = unattended, 1 = an average worker.
 * Milestone 5 adds employees; for now only the owner can staff a checkout.
 */
export function operatorSpeed(s: GameState, shop: ShopState, obj: PlacedObject): number {
  if (defOf(obj).kind !== 'register') return 0;
  if (s.ownerAt?.shopId === shop.id && s.ownerAt.objectId === obj.id) return 1;
  return 0;
}
