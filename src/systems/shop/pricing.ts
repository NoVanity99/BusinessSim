import { clamp } from '../../core/format';
import type { GameState } from '../../core/state';
import { PRODUCTS, SHOP_TYPES } from '../../data';
import { decorScore, defOf, type ShopState } from '../../entities/Shop';
import { marketPrice } from '../economy/market';

/** Total fun on offer from working attractions; what a park ticket is "worth". */
export function parkValue(shop: ShopState): number {
  let v = 0;
  for (const o of shop.objects) if (defOf(o).service === 'ride') v += (defOf(o).fun ?? 0) * (o.broken ? 0.5 : 1);
  return v;
}

/**
 * The price a customer considers fair for something in this particular shop.
 * Park tickets scale with the attractions on offer; cafés with nice decor can charge more.
 */
export function fairPrice(s: GameState, shop: ShopState, product: string): number {
  if (product === 'svc_ticket') return PRODUCTS[product].market * 0.5 + parkValue(shop) * 0.42;
  const weight = SHOP_TYPES[shop.type].decorWeight ?? 0;
  const ambience = weight ? 1 + clamp(decorScore(shop) * 0.22 * weight, -0.1, 0.3) : 1;
  return marketPrice(s, product) * ambience;
}
