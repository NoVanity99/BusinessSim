import { bus, toast } from '../../core/events';
import { insured } from '../economy/corporate';
import { wantedDownstream } from '../logistics/logistics';
import { recordSale } from '../../entities/Shop';
import { money } from '../../core/format';
import { rand } from '../../core/rng';
import type { GameState } from '../../core/state';
import { FURNITURE, PRODUCTS, SHOP_TYPES } from '../../data';
import { defOf, storageCapacity, storageUsed, type PlacedObject, type ShopState } from '../../entities/Shop';
import { earn, tryPay } from '../economy/finance';
import { wholesalePrice } from '../economy/market';
import { addToStorage, consumeIngredients, hasIngredients, inStorage, takeFromStorage } from '../economy/stock';
import { onDuty, performance } from '../staff/staff';
import { dayOf } from '../time/clock';
import { breakMult } from './modifiers';

/** Share of the wholesale price the market pays for goods you make yourself. */
export const FACTORY_SALE_SHARE = 0.9;

/** What a producer in this shop can be set to make. */
export function recipesFor(shop: ShopState, obj: PlacedObject): string[] {
  const type = SHOP_TYPES[shop.type];
  const station = defOf(obj).station;
  return [...new Set([...type.products, ...type.supplies])].filter((p) => PRODUCTS[p].recipe && PRODUCTS[p].station === station);
}

export const factoryPrice = (s: GameState, product: string): number => wholesalePrice(s, product) * FACTORY_SALE_SHARE;

/** Sell finished goods from a factory's back room to the wholesale market. */
export function sellWholesale(s: GameState, shop: ShopState, product: string, qty: number): number {
  const n = takeFromStorage(shop, product, qty);
  if (!n) return 0;
  const value = n * factoryPrice(s, product);
  earn(s, value, 'wholesale');
  shop.today.revenue += value;
  recordSale(shop, product, value);
  return value;
}

/** Pay to have a broken machine fixed on the spot. */
export function repairNow(s: GameState, shop: ShopState, obj: PlacedObject): boolean {
  // Breakdown cover means the call-out is free.
  const cost = insured(s, 'breakdown') ? 0 : FURNITURE[obj.def].repairCost ?? 50;
  if (!obj.broken) return false;
  if (cost > 0 && !tryPay(s, cost, 'maintenance')) {
    toast(`You need ${money(cost)} for the repair.`, 'bad');
    return false;
  }
  obj.broken = false;
  shop.today.costs += cost;
  bus.emit('shop:changed', shop.id);
  return true;
}

/** Why a producer is not running, or null if it is. */
export function producerStatus(s: GameState, shop: ShopState, obj: PlacedObject): string | null {
  const d = defOf(obj);
  if (obj.broken) return 'Broken down';
  if (!obj.recipe) return 'No recipe chosen';
  const p = PRODUCTS[obj.recipe];
  if ((obj.progress ?? 0) > 0) return null;
  if (!d.auto && !s.staff.some((e) => e.shopId === shop.id && e.role === 'stocker' && onDuty(s, e))) return 'Needs a stocker on shift to run it';
  if (!hasIngredients(shop, p.recipe)) return 'Waiting for ingredients';
  // Perishables are made to order; long-life goods are allowed to pile up a little.
  const limit = (p.batch ?? 1) * (p.shelfLife ? 1 : 6);
  if (inStorage(shop, obj.recipe) >= limit) return 'Enough in stock for now';
  if (storageUsed(shop) + (p.batch ?? 1) > storageCapacity(shop)) return 'Storage is full';
  return null;
}

/** Run every producer (ovens, vats, bottling lines) for `dt` game minutes. */
export function updateProduction(s: GameState, dt: number): void {
  for (const shop of s.shops) {
    const producers = shop.objects.filter((o) => defOf(o).kind === 'producer' && o.recipe);
    if (!producers.length) continue;
    // Operatives share their effort across the machines that need them.
    const crew = s.staff.filter((e) => e.shopId === shop.id && e.role === 'stocker' && onDuty(s, e)).reduce((a, e) => a + performance(e), 0);
    const manned = producers.filter((o) => !defOf(o).auto && !o.broken).length;
    const crewSpeed = manned ? Math.min(1.5, (crew * 2) / manned) : 0;

    for (const obj of producers) {
      const d = defOf(obj);
      const p = PRODUCTS[obj.recipe!];
      if (obj.broken) continue;
      if (!(obj.progress ?? 0)) {
        if (producerStatus(s, shop, obj) !== null || !consumeIngredients(shop, p.recipe)) continue;
        obj.progress = 0.001;
      }
      obj.progress! += dt * (d.auto ? 1 : crewSpeed);
      if (obj.progress! < (p.prepMinutes ?? 30)) continue;
      obj.progress = 0;
      const made = p.batch ?? 1;
      addToStorage(shop, obj.recipe!, made, p.shelfLife ? dayOf(s.time) + p.shelfLife : 0);
      // Sell the batch unless a shop this factory supplies has a use for it.
      if (shop.autoSell && !wantedDownstream(s, shop, obj.recipe!)) sellWholesale(s, shop, obj.recipe!, made);
      bus.emit('stock:changed', shop.id);
      if (d.breakChance && rand.chance(d.breakChance * breakMult(s, shop))) {
        obj.broken = true;
        toast(`${shop.name}: the ${d.name.toLowerCase()} has broken down.`, 'warn');
        bus.emit('shop:changed', shop.id);
      }
    }
  }
}
