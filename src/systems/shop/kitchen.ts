import { bus, toast } from '../../core/events';
import { rand } from '../../core/rng';
import { session, shopById } from '../../core/state';
import { PRODUCTS } from '../../data';
import { defOf, registers, type ShopState } from '../../entities/Shop';
import { rt } from '../ai/runtime';
import { performance } from '../staff/staff';
import { breakMult } from './modifiers';
import { operatorSpeed } from './status';

/** Speed of the fallback "cook" when nobody is hired: whoever runs the counter does it between customers. */
const COUNTER_STAFF_COOK_SPEED = 0.45;

/** Can this shop make a menu item right now (ignoring ingredients)? */
export function kitchenCanMake(shop: ShopState, item: string): boolean {
  const station = PRODUCTS[item].station;
  if (!station) return true;
  return shop.objects.some((o) => !o.broken && defOf(o).kind === 'cookstation' && defOf(o).station === station);
}

export function openTicket(shopId: number, customerId: number, items: string[]): void {
  let list = rt.kitchens.get(shopId);
  if (!list) rt.kitchens.set(shopId, (list = []));
  list.push({ customerId, age: 0, items: items.map((product) => ({ product, left: PRODUCTS[product].prepMinutes ?? 1, started: false })) });
}

/** Cooks on shift and physically in the kitchen, as work-rate multipliers. */
function cookSpeeds(shop: ShopState): number[] {
  const s = session.state;
  const speeds = s.staff.filter((e) => e.shopId === shop.id && e.role === 'cook' && rt.staff.get(e.id)?.state === 'working').map((e) => performance(e));
  if (speeds.length) return speeds;
  const counterStaffed = registers(shop).some((r) => operatorSpeed(s, shop, r) > 0);
  return counterStaffed ? [COUNTER_STAFF_COOK_SPEED] : [];
}

/**
 * Advance every kitchen. Each cook works one item at a time and each station holds one item.
 * Returns the tickets that just became ready.
 */
export function updateKitchens(dt: number): { customerId: number; minutes: number }[] {
  const ready: { customerId: number; minutes: number }[] = [];
  for (const [shopId, tickets] of rt.kitchens) {
    const shop = shopById(session.state, shopId);
    if (!shop || !tickets.length) {
      if (!shop) rt.kitchens.delete(shopId);
      continue;
    }
    const cooks = cookSpeeds(shop);
    const stations: Record<string, number> = {};
    for (const o of shop.objects) {
      const d = defOf(o);
      if (d.kind === 'cookstation' && !o.broken && d.station) stations[d.station] = (stations[d.station] ?? 0) + 1;
    }

    let cook = 0;
    for (let t = tickets.length - 1; t >= 0; t--) {
      const c = rt.byId.get(tickets[t].customerId);
      if (!c || c.state !== 'awaitOrder') tickets.splice(t, 1);
    }
    for (const ticket of tickets) {
      ticket.age += dt;
      for (const item of ticket.items) {
        if (item.left <= 0 || cook >= cooks.length) continue;
        const station = PRODUCTS[item.product].station;
        if (station) {
          if (!stations[station]) continue;
          stations[station]--;
        }
        item.started = true;
        item.left -= dt * cooks[cook++];
        if (item.left <= 0 && station) {
          // Heavy use wears equipment out.
          const obj = shop.objects.find((o) => !o.broken && defOf(o).kind === 'cookstation' && defOf(o).station === station);
          const d = obj ? defOf(obj) : undefined;
          if (obj && d?.breakChance && rand.chance(d.breakChance * breakMult(session.state, shop))) {
            obj.broken = true;
            toast(`${shop.name}: the ${d.name.toLowerCase()} has broken down.`, 'warn');
            bus.emit('shop:changed', shop.id);
          }
        }
      }
    }
    for (let t = tickets.length - 1; t >= 0; t--) {
      if (tickets[t].items.every((i) => i.left <= 0)) {
        ready.push({ customerId: tickets[t].customerId, minutes: tickets[t].age });
        tickets.splice(t, 1);
      }
    }
  }
  return ready;
}

/** Orders waiting or cooking in a shop, for the overview. */
export const openOrders = (shopId: number): number => rt.kitchens.get(shopId)?.length ?? 0;
