import { toast } from '../../core/events';
import type { GameState } from '../../core/state';
import { PRODUCTS } from '../../data';
import { batchQty, defOf, shelfQty, type ShopState } from '../../entities/Shop';
import { freeStorage, incomingUnits, placeOrder, quoteOrder, type OrderLine } from '../economy/stock';
import { onDuty } from './staff';

/** Keep this much cash untouched when a manager places orders. */
const CASH_RESERVE = 300;

export const managerOnDuty = (s: GameState, shop: ShopState): boolean => s.staff.some((e) => e.shopId === shop.id && e.role === 'manager' && onDuty(s, e));

/**
 * A manager tops up every product that has shelf space assigned to it, aiming for
 * one full set of shelves plus the same again in the back room.
 */
export function managerReorder(s: GameState): void {
  for (const shop of s.shops) {
    if (!shop.autoReorder || !managerOnDuty(s, shop)) continue;
    const capacity: Record<string, number> = {};
    for (const o of shop.objects) for (const sl of o.slots ?? []) if (sl.product) capacity[sl.product] = (capacity[sl.product] ?? 0) + (defOf(o).slotCapacity ?? 0);

    let free = freeStorage(s, shop);
    const lines: OrderLine[] = [];
    for (const [product, cap] of Object.entries(capacity)) {
      const have = shelfQty(shop, product) + batchQty(shop.storage[product]) + incomingUnits(s, shop.id, product);
      if (have >= cap) continue;
      const size = PRODUCTS[product].caseSize;
      const cases = Math.min(Math.ceil((cap * 2 - have) / size), Math.floor(free / size));
      if (cases <= 0) continue;
      lines.push({ product, cases });
      free -= cases * size;
    }
    if (!lines.length) continue;
    if (quoteOrder(s, lines, false).total > s.money - CASH_RESERVE) {
      toast(`${shop.name}: the manager wants to reorder stock but cash is too low.`, 'warn');
      continue;
    }
    placeOrder(s, shop, lines, false);
  }
}
