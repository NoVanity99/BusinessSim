import { bus, toast } from '../../core/events';
import { money } from '../../core/format';
import { session, shopById, type GameState } from '../../core/state';
import { FURNITURE, LOGISTICS as L, PRODUCTS, SHOP_TYPES } from '../../data';
import { batchQty, defOf, shelfQty, type ShopState } from '../../entities/Shop';
import { tryPay } from '../economy/finance';
import { wholesalePrice } from '../economy/market';
import { addToStorage, freeStorage, incomingUnits, takeFromStorage } from '../economy/stock';
import { onDuty } from '../staff/staff';
import { dayOf } from '../time/clock';

/**
 * Your own supply chain. A warehouse or factory with a van bay and a driver delivers
 * to the shops it supplies; supplier contracts bring a fixed order every morning at a
 * locked, discounted price.
 */

// ---------- Usage ----------

/**
 * Units of each product a shop gets through per day, from its recent takings.
 * Ingredients are counted through the recipes of the menu items and services sold.
 */
export function dailyUse(shop: ShopState): Record<string, number> {
  const days = [...shop.history.slice(-3), shop.today];
  const use: Record<string, number> = {};
  for (const d of days) {
    for (const [p, revenue] of Object.entries(d.byProduct ?? {})) {
      const price = shop.prices[p];
      const def = PRODUCTS[p];
      if (!price || !def) continue;
      const units = revenue / price;
      const madeToOrder = def.recipe && (def.kind === 'menu' || def.kind === 'service');
      if (madeToOrder) for (const [input, qty] of Object.entries(def.recipe!)) use[input] = (use[input] ?? 0) + units * qty;
      else use[p] = (use[p] ?? 0) + units;
    }
  }
  // Today is only part of a day; count it for what it is worth so far.
  const span = Math.max(0.5, days.length - 1 + (session.state.time.minutes % 1440) / 1440);
  for (const p of Object.keys(use)) use[p] /= span;
  return use;
}

/** What a shop needs to hold of each product: a couple of days' use, or at least what its shelves display. */
export function stockTargets(shop: ShopState): Record<string, number> {
  const targets: Record<string, number> = {};
  for (const o of shop.objects) for (const sl of o.slots ?? []) if (sl.product) targets[sl.product] = (targets[sl.product] ?? 0) + (defOf(o).slotCapacity ?? 0) * 1.5;
  for (const [p, perDay] of Object.entries(dailyUse(shop))) targets[p] = Math.max(targets[p] ?? 0, perDay * L.coverDays);
  // Producers need their inputs on hand.
  for (const o of shop.objects) if (o.recipe) for (const input of Object.keys(PRODUCTS[o.recipe].recipe ?? {})) targets[input] = Math.max(targets[input] ?? 0, PRODUCTS[input].caseSize);
  return targets;
}

// ---------- Supply links ----------

/** Sites that can supply other shops: warehouses and factories. */
export const isSupplier = (shop: ShopState): boolean => shop.type === 'warehouse' || SHOP_TYPES[shop.type].flow === 'factory';
export const suppliers = (s: GameState): ShopState[] => s.shops.filter(isSupplier);
export const supplierOf = (s: GameState, shop: ShopState): ShopState | undefined => (shop.supplierId ? shopById(s, shop.supplierId) : undefined);
export const suppliedBy = (s: GameState, supplier: ShopState): ShopState[] => {
  const order = supplier.route ?? [];
  return s.shops.filter((sh) => sh.supplierId === supplier.id).sort((a, b) => (order.indexOf(a.id) + 1 || 999) - (order.indexOf(b.id) + 1 || 999));
};

export const vansAt = (shop: ShopState): number => shop.objects.reduce((a, o) => a + (FURNITURE[o.def].vans ?? 0), 0);
export const driversOnDuty = (s: GameState, shop: ShopState): number => s.staff.filter((e) => e.shopId === shop.id && e.role === 'driver' && onDuty(s, e)).length;

/** Why a supplier is not delivering, or null if it can. */
export function deliveryProblem(s: GameState, supplier: ShopState): string | null {
  if (!vansAt(supplier)) return 'No van bay';
  if (!s.staff.some((e) => e.shopId === supplier.id && e.role === 'driver')) return 'No driver hired';
  if (!driversOnDuty(s, supplier)) return 'No driver on shift';
  return null;
}

export function setSupplier(s: GameState, shop: ShopState, supplierId: number | null): void {
  shop.supplierId = supplierId ?? undefined;
  bus.emit('shop:changed', shop.id);
  bus.emit('logistics:changed');
}

/** Move a shop earlier or later on a supplier's round. */
export function moveOnRoute(s: GameState, supplier: ShopState, shopId: number, dir: -1 | 1): void {
  const ids = suppliedBy(s, supplier).map((sh) => sh.id);
  const i = ids.indexOf(shopId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  supplier.route = ids;
  bus.emit('logistics:changed');
}

/** True if this product is something the supplier holds or makes, so the shop need not buy it elsewhere. */
export function suppliesProduct(supplier: ShopState, product: string): boolean {
  return batchQty(supplier.storage[product]) > 0 || supplier.objects.some((o) => o.recipe === product);
}

/** Does anything this site supplies want this product? Used to keep factory output instead of selling it. */
export function wantedDownstream(s: GameState, supplier: ShopState, product: string): boolean {
  return s.shops.some((sh) => sh.supplierId === supplier.id && [...SHOP_TYPES[sh.type].products, ...SHOP_TYPES[sh.type].supplies].includes(product));
}

const lotCentre = (shop: ShopState): { x: number; y: number } => {
  const lot = session.city.lots[shop.lotId];
  return { x: lot.x + lot.w / 2, y: lot.y + lot.h / 2 };
};
const tripMinutes = (a: ShopState, b: ShopState): number => Math.round(L.loadMinutes + (Math.abs(lotCentre(a).x - lotCentre(b).x) + Math.abs(lotCentre(a).y - lotCentre(b).y)) * L.minutesPerTile);

/** Vans out on the road from each supplier, so a site never sends more than it has. Keyed by supplier id: return times. */
const vansOut = new Map<number, number[]>();
export function resetLogistics(): void {
  vansOut.clear();
}

/**
 * Send vans from every supplier that has one free. Each van takes one shop's order: as much
 * of what it is short of as the supplier holds and the van can carry. Shops are served in route order.
 */
export function dispatchDeliveries(s: GameState): void {
  const now = s.time.minutes;
  for (const supplier of suppliers(s)) {
    if (deliveryProblem(s, supplier)) continue;
    const out = (vansOut.get(supplier.id) ?? []).filter((t) => t > now);
    let free = Math.min(vansAt(supplier), driversOnDuty(s, supplier)) - out.length;
    for (const shop of suppliedBy(s, supplier)) {
      if (free <= 0) break;
      const targets = stockTargets(shop);
      const allowed = new Set([...SHOP_TYPES[shop.type].products, ...SHOP_TYPES[shop.type].supplies]);
      let room = Math.min(L.vanCapacity, freeStorage(s, shop));
      const load: { product: string; qty: number }[] = [];
      // Whatever is furthest below target goes on first.
      const wants = Object.entries(targets)
        .filter(([p]) => allowed.has(p))
        .map(([p, target]) => ({ p, target, have: shelfQty(shop, p) + batchQty(shop.storage[p]) + incomingUnits(s, shop.id, p) }))
        .filter((w) => w.have < w.target * 0.6)
        .sort((a, b) => a.have / a.target - b.have / b.target);
      // First a fair share of the van for everything that is short, then top up with whatever space is left,
      // so one fast seller does not leave the other shelves empty.
      const share = Math.max(1, Math.floor(room / Math.max(1, wants.length)));
      for (const pass of [0, 1]) {
        for (const w of wants) {
          if (room <= 0) break;
          const already = load.find((l) => l.product === w.p)?.qty ?? 0;
          const need = Math.ceil(w.target - w.have) - already;
          const qty = Math.min(need, room, batchQty(supplier.storage[w.p]), pass === 0 ? share : Infinity);
          if (qty <= 0) continue;
          const sent = takeFromStorage(supplier, w.p, qty);
          if (!sent) continue;
          const line = load.find((l) => l.product === w.p);
          if (line) line.qty += sent;
          else load.push({ product: w.p, qty: sent });
          room -= sent;
        }
      }
      if (!load.length) continue;
      const minutes = tripMinutes(supplier, shop);
      // Rides the normal delivery system; "cases" are sized so the unit count comes out exact.
      s.orders.push({ id: s.nextOrderId++, shopId: shop.id, lines: load.map((l) => ({ product: l.product, cases: l.qty / PRODUCTS[l.product].caseSize })), cost: 0, arriveAt: Math.floor(now) + minutes, express: false, fromShopId: supplier.id });
      out.push(now + minutes * 2);
      free--;
      bus.emit('delivery:sent', { fromShopId: supplier.id, toShopId: shop.id });
      bus.emit('stock:changed', supplier.id);
      bus.emit('orders:changed');
    }
    vansOut.set(supplier.id, out);
  }
}

// ---------- Supplier contracts ----------

/** A standing order: so many cases of one product to one shop every morning, at a locked price. */
export interface Contract {
  id: number;
  supplier: string;
  shopId: number;
  product: string;
  cases: number;
  /** Locked price per unit. */
  unitPrice: number;
  /** Last day it delivers. */
  untilDay: number;
}

export const contractUnitPrice = (s: GameState, supplier: string, product: string): number => Math.round(wholesalePrice(s, product) * (1 - L.suppliers[supplier].discount) * 100) / 100;
export const contractDailyCost = (c: Contract): number => Math.round(c.cases * PRODUCTS[c.product].caseSize * c.unitPrice * 100) / 100;

export function signContract(s: GameState, supplier: string, shop: ShopState, product: string, cases: number): boolean {
  const def = L.suppliers[supplier];
  if (!def || cases < def.minCases || !PRODUCTS[product]) return false;
  const c: Contract = { id: s.nextContractId++, supplier, shopId: shop.id, product, cases, unitPrice: contractUnitPrice(s, supplier, product), untilDay: dayOf(s.time) + def.days };
  s.contracts.push(c);
  toast(`Contract signed with ${def.name}: ${cases} case${cases === 1 ? '' : 's'} of ${PRODUCTS[product].name.toLowerCase()} to ${shop.name} every morning for ${def.days} days at ${money(c.unitPrice)} each.`, 'good');
  bus.emit('logistics:changed');
  return true;
}

/** Ending a contract early costs two days of deliveries you do not receive. */
export const cancelFee = (c: Contract): number => Math.round(contractDailyCost(c) * 2 * L.suppliers[c.supplier].missedShare * 2);

export function cancelContract(s: GameState, id: number): boolean {
  const c = s.contracts.find((x) => x.id === id);
  if (!c) return false;
  const fee = cancelFee(c);
  if (fee > 0 && !tryPay(s, fee, 'stock')) {
    toast(`You need ${money(fee)} to end that contract early.`, 'bad');
    return false;
  }
  s.contracts.splice(s.contracts.indexOf(c), 1);
  bus.emit('logistics:changed');
  return true;
}

/** Start of day: every contract delivers, whatever the market is doing. */
export function contractsDaily(s: GameState): void {
  const day = dayOf(s.time);
  for (const c of [...s.contracts]) {
    const shop = shopById(s, c.shopId);
    const def = L.suppliers[c.supplier];
    if (!shop || !def || c.untilDay < day) {
      s.contracts.splice(s.contracts.indexOf(c), 1);
      if (shop && def) toast(`Your contract with ${def.name} for ${PRODUCTS[c.product].name.toLowerCase()} at ${shop.name} has run out.`, 'info');
      continue;
    }
    const size = PRODUCTS[c.product].caseSize;
    const fit = Math.min(c.cases, Math.floor(freeStorage(s, shop) / size));
    const refused = c.cases - fit;
    const cost = Math.round((fit * size * c.unitPrice + refused * size * c.unitPrice * def.missedShare) * 100) / 100;
    if (!tryPay(s, cost, 'stock')) {
      toast(`${def.name} would not deliver to ${shop.name}: the account is short of ${money(cost)}.`, 'bad');
      continue;
    }
    shop.today.costs += cost;
    if (fit > 0) addToStorage(shop, c.product, fit * size, PRODUCTS[c.product].shelfLife ? day + PRODUCTS[c.product].shelfLife : 0);
    if (refused > 0) toast(`${shop.name} had no room for ${refused} case${refused === 1 ? '' : 's'} of ${PRODUCTS[c.product].name.toLowerCase()} from ${def.name}${def.missedShare ? `. You were charged ${Math.round(def.missedShare * 100)}% for them anyway` : ''}.`, 'warn');
    bus.emit('stock:changed', shop.id);
  }
  bus.emit('logistics:changed');
}
