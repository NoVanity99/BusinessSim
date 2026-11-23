import { toast } from '../../core/events';
import { deliveryProblem, stockTargets, suppliedBy, supplierOf, suppliesProduct } from '../logistics/logistics';
import type { GameState } from '../../core/state';
import { PRODUCTS, SHOP_TYPES } from '../../data';
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

    // Ingredients, fuel and anything else used straight from the back room: keep a case around.
    for (const p of [...SHOP_TYPES[shop.type].products, ...SHOP_TYPES[shop.type].supplies]) {
      const d = PRODUCTS[p];
      if (d.wholesale <= 0 || !['ingredient', 'fuel'].includes(d.kind ?? 'good')) continue;
      const used = shop.objects.some((o) => o.recipe && PRODUCTS[o.recipe].recipe?.[p]) || SHOP_TYPES[shop.type].products.some((m) => PRODUCTS[m].recipe?.[p] && PRODUCTS[m].kind !== 'crafted') || d.kind === 'fuel';
      if (used) capacity[p] = Math.max(capacity[p] ?? 0, d.caseSize);
    }

    // A warehouse orders for the shops it supplies: enough of everything they are getting through.
    if (shop.type === 'warehouse') {
      for (const client of suppliedBy(s, shop)) for (const [p, target] of Object.entries(stockTargets(client))) if (PRODUCTS[p].wholesale > 0 && !PRODUCTS[p].recipe) capacity[p] = (capacity[p] ?? 0) + target;
    }
    const supplier = supplierOf(s, shop);
    const delivering = supplier && !deliveryProblem(s, supplier);

    let free = freeStorage(s, shop);
    const lines: OrderLine[] = [];
    for (const [product, cap] of Object.entries(capacity)) {
      // Its own supplier brings this; leave it to the vans.
      if (delivering && suppliesProduct(supplier, product)) continue;
      const have = shelfQty(shop, product) + batchQty(shop.storage[product]) + incomingUnits(s, shop.id, product);
      if (have >= cap) continue;
      const size = PRODUCTS[product].caseSize;
      const cases = Math.min(Math.ceil((cap * 2 - have) / size), Math.floor(free / size));
      if (cases <= 0) continue;
      lines.push({ product, cases });
      free -= cases * size;
    }
    if (!lines.length) continue;
    if (quoteOrder(s, lines, false, shop).total > s.money - CASH_RESERVE) {
      toast(`${shop.name}: the manager wants to reorder stock but cash is too low.`, 'warn');
      continue;
    }
    placeOrder(s, shop, lines, false);
  }
}
