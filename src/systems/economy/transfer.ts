import { bus, toast } from '../../core/events';
import { money } from '../../core/format';
import type { GameState } from '../../core/state';
import { PRODUCTS, SHOP_TYPES } from '../../data';
import type { ShopState } from '../../entities/Shop';
import { onDuty } from '../staff/staff';
import { tryPay } from './finance';
import { freeStorage, takeFromStorage } from './stock';

export const COURIER_FEE = 18;
const COURIER_HOURS = 3;
const OWN_VAN_HOURS = 1;

/** Shops (other than the source) that can stock a product. */
export function destinationsFor(s: GameState, from: ShopState, product: string): ShopState[] {
  return s.shops.filter((sh) => sh.id !== from.id && [...SHOP_TYPES[sh.type].products, ...SHOP_TYPES[sh.type].supplies].includes(product));
}

/**
 * Move stock between your own businesses. A driver on shift at the sending shop
 * does it free and fast; otherwise a courier charges a fee.
 */
export function transferStock(s: GameState, from: ShopState, to: ShopState, product: string, qty: number): boolean {
  const room = freeStorage(s, to);
  qty = Math.min(qty, room);
  if (qty <= 0) {
    toast(`${to.name} has no storage space for that.`, 'bad');
    return false;
  }
  const ownVan = s.staff.some((e) => e.shopId === from.id && e.role === 'driver' && onDuty(s, e));
  if (!ownVan && !tryPay(s, COURIER_FEE, 'other')) {
    toast(`You need ${money(COURIER_FEE)} for the courier.`, 'bad');
    return false;
  }
  const sent = takeFromStorage(from, product, qty);
  if (!sent) return false;
  const size = PRODUCTS[product].caseSize;
  // Rides the normal delivery system; "cases" are sized so the unit count comes out exact.
  s.orders.push({ id: s.nextOrderId++, shopId: to.id, lines: [{ product, cases: sent / size }], cost: 0, arriveAt: Math.floor(s.time.minutes) + (ownVan ? OWN_VAN_HOURS : COURIER_HOURS) * 60, express: false });
  toast(`${sent} ${PRODUCTS[product].name} on the way to ${to.name}${ownVan ? ' in your own van' : ` by courier (${money(COURIER_FEE)})`}.`, 'good');
  bus.emit('orders:changed');
  return true;
}
