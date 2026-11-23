import { bus, toast } from '../../core/events';
import { money } from '../../core/format';
import type { GameState } from '../../core/state';
import { defOf, type PlacedObject, type ShopState } from '../../entities/Shop';
import { earn, tryPay } from '../economy/finance';
import { fillObject } from '../economy/stock';

/** Cost of sending someone out to one machine when you have no driver doing rounds. */
export const SERVICE_CALL_FEE = 12;

export const machinesOf = (shop: ShopState): PlacedObject[] => shop.objects.filter((o) => defOf(o).kind === 'vending');

/** Refill a machine from the depot and bank its cash. */
export function restockMachine(s: GameState, shop: ShopState, obj: PlacedObject): void {
  fillObject(shop, obj);
  const cash = obj.cash ?? 0;
  if (cash > 0) {
    earn(s, cash, 'sales');
    shop.today.revenue += cash;
    obj.cash = 0;
  }
  bus.emit('stock:changed', shop.id);
}

/** Player-triggered visit to one machine, for a call-out fee. */
export function serviceMachine(s: GameState, shop: ShopState, obj: PlacedObject): boolean {
  if (!tryPay(s, SERVICE_CALL_FEE, 'other')) {
    toast(`You need ${money(SERVICE_CALL_FEE)} for the call-out.`, 'bad');
    return false;
  }
  shop.today.costs += SERVICE_CALL_FEE;
  restockMachine(s, shop, obj);
  return true;
}
