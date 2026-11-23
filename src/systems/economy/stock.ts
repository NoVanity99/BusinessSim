import { bus, toast } from '../../core/events';
import { money } from '../../core/format';
import { shopById, type GameState } from '../../core/state';
import { ECONOMY, FURNITURE, PRODUCTS } from '../../data';
import { batchQty, defOf, storageCapacity, storageUsed, type PlacedObject, type ShelfSlot, type ShopState, type StockBatch } from '../../entities/Shop';
import { dayOf } from '../time/clock';
import { tryPay } from './finance';
import { wholesalePrice } from './market';

export interface OrderLine {
  product: string;
  cases: number;
}

export interface Order {
  id: number;
  shopId: number;
  lines: OrderLine[];
  cost: number;
  /** Absolute game minute of arrival. */
  arriveAt: number;
  express: boolean;
}

export interface Quote {
  units: number;
  cases: number;
  subtotal: number;
  discount: number;
  discountAmount: number;
  surcharge: number;
  deliveryFee: number;
  total: number;
  hours: number;
}

export function bulkDiscount(cases: number): number {
  let d = 0;
  for (const tier of ECONOMY.wholesale.bulkDiscounts) if (cases >= tier.cases) d = tier.discount;
  return d;
}

export function quoteOrder(s: GameState, lines: OrderLine[], express: boolean): Quote {
  const w = ECONOMY.wholesale;
  let subtotal = 0;
  let units = 0;
  let cases = 0;
  for (const l of lines) {
    const n = l.cases * PRODUCTS[l.product].caseSize;
    units += n;
    cases += l.cases;
    subtotal += n * wholesalePrice(s, l.product);
  }
  const discount = bulkDiscount(cases);
  const discountAmount = subtotal * discount;
  const surcharge = express ? (subtotal - discountAmount) * w.expressSurcharge : 0;
  const deliveryFee = cases > 0 ? w.deliveryFee : 0;
  const total = Math.round((subtotal - discountAmount + surcharge + deliveryFee) * 100) / 100;
  return { units, cases, subtotal, discount, discountAmount, surcharge, deliveryFee, total, hours: express ? w.expressHours : w.standardHours };
}

/** Units already ordered for a shop and still on the road. */
export function incomingUnits(s: GameState, shopId: number, product?: string): number {
  let n = 0;
  for (const o of s.orders) {
    if (o.shopId !== shopId) continue;
    for (const l of o.lines) if (!product || l.product === product) n += l.cases * PRODUCTS[l.product].caseSize;
  }
  return n;
}

export function freeStorage(s: GameState, shop: ShopState): number {
  return storageCapacity(shop) - storageUsed(shop) - incomingUnits(s, shop.id);
}

export function placeOrder(s: GameState, shop: ShopState, lines: OrderLine[], express: boolean): boolean {
  lines = lines.filter((l) => l.cases > 0);
  if (!lines.length) return false;
  const q = quoteOrder(s, lines, express);
  if (q.units > freeStorage(s, shop)) {
    toast('Not enough back-room storage for that order. Add storage racks or order less.', 'bad');
    return false;
  }
  if (!tryPay(s, q.total, 'stock')) {
    toast(`You need ${money(q.total)} for that order.`, 'bad');
    return false;
  }
  shop.today.costs += q.total;
  s.orders.push({ id: s.nextOrderId++, shopId: shop.id, lines, cost: q.total, arriveAt: Math.floor(s.time.minutes) + q.hours * 60, express });
  toast(`Order placed for ${shop.name}. Arrives in ${q.hours} hours.`, 'good');
  bus.emit('orders:changed');
  return true;
}

function addBatch(batches: StockBatch[], qty: number, expires: number): void {
  const same = batches.find((b) => b.expires === expires);
  if (same) same.qty += qty;
  else {
    batches.push({ qty, expires });
    batches.sort((a, b) => (a.expires || Infinity) - (b.expires || Infinity));
  }
}

export function addToStorage(shop: ShopState, product: string, qty: number, expires: number): void {
  if (qty <= 0) return;
  addBatch((shop.storage[product] ??= []), qty, expires);
}

/** Remove up to `qty` units, oldest first. Returns the batches taken. */
function takeBatches(batches: StockBatch[], qty: number): StockBatch[] {
  const taken: StockBatch[] = [];
  while (qty > 0 && batches.length) {
    const b = batches[0];
    const n = Math.min(qty, b.qty);
    taken.push({ qty: n, expires: b.expires });
    b.qty -= n;
    qty -= n;
    if (b.qty <= 0) batches.shift();
  }
  return taken;
}

/** Deliver any orders whose time has come. Call once per game minute. */
export function processDeliveries(s: GameState): void {
  const now = s.time.minutes;
  let delivered = false;
  for (let i = s.orders.length - 1; i >= 0; i--) {
    const o = s.orders[i];
    if (o.arriveAt > now) continue;
    s.orders.splice(i, 1);
    delivered = true;
    const shop = shopById(s, o.shopId);
    if (!shop) continue;
    const today = dayOf(s.time);
    for (const l of o.lines) {
      const def = PRODUCTS[l.product];
      addToStorage(shop, l.product, Math.round(l.cases * def.caseSize), def.shelfLife ? today + def.shelfLife : 0);
    }
    toast(`Delivery arrived at ${shop.name}.`, 'good');
    bus.emit('stock:changed', shop.id);
  }
  if (delivered) bus.emit('orders:changed');
}

export function hoursUntil(s: GameState, o: Order): number {
  return Math.max(0, (o.arriveAt - s.time.minutes) / 60);
}

// ---------- Shelves ----------

export function newSlots(defId: string): ShelfSlot[] | undefined {
  const d = FURNITURE[defId];
  if (d.kind !== 'shelf' && d.kind !== 'vending') return undefined;
  return Array.from({ length: d.slots ?? 1 }, () => ({ product: null, batches: [] }));
}

export function slotAccepts(obj: PlacedObject, product: string): boolean {
  return (defOf(obj).accepts ?? []).includes(PRODUCTS[product].storage);
}

/** Return a slot's contents to the back room and change what it displays. */
export function assignSlot(shop: ShopState, obj: PlacedObject, slotIndex: number, product: string | null): void {
  const slot = obj.slots?.[slotIndex];
  if (!slot || slot.product === product) return;
  if (product && !slotAccepts(obj, product)) return;
  if (slot.product) for (const b of slot.batches) addToStorage(shop, slot.product, b.qty, b.expires);
  slot.product = product;
  slot.batches = [];
  bus.emit('stock:changed', shop.id);
}

/** Move stock from the back room onto one slot. Returns units moved. */
export function fillSlot(shop: ShopState, obj: PlacedObject, slotIndex: number, maxUnits = Infinity): number {
  const slot = obj.slots?.[slotIndex];
  if (!slot?.product) return 0;
  const cap = defOf(obj).slotCapacity ?? 0;
  const room = Math.min(maxUnits, cap - batchQty(slot.batches));
  const src = shop.storage[slot.product];
  if (room <= 0 || !src?.length) return 0;
  let moved = 0;
  for (const b of takeBatches(src, room)) {
    addBatch(slot.batches, b.qty, b.expires);
    moved += b.qty;
  }
  if (moved) bus.emit('stock:changed', shop.id);
  return moved;
}

export function fillObject(shop: ShopState, obj: PlacedObject): number {
  let moved = 0;
  obj.slots?.forEach((_s, i) => (moved += fillSlot(shop, obj, i)));
  return moved;
}

/** Take one unit off a shelf slot (a customer picking it up). */
export function takeFromSlot(shop: ShopState, slot: ShelfSlot, qty = 1): number {
  const taken = takeBatches(slot.batches, qty).reduce((a, b) => a + b.qty, 0);
  if (taken) bus.emit('stock:changed', shop.id);
  return taken;
}

/** Move everything on an object's shelves back to storage (when selling or moving it). */
export function emptyObject(shop: ShopState, obj: PlacedObject): void {
  for (const slot of obj.slots ?? []) {
    if (slot.product) for (const b of slot.batches) addToStorage(shop, slot.product, b.qty, b.expires);
    slot.batches = [];
  }
}

/** Throw away spoiled stock at the start of a day. Returns units discarded per shop. */
export function expireStock(s: GameState): void {
  const today = dayOf(s.time);
  for (const shop of s.shops) {
    let lost = 0;
    const purge = (batches: StockBatch[]): StockBatch[] =>
      batches.filter((b) => {
        const bad = b.expires > 0 && b.expires <= today;
        if (bad) lost += b.qty;
        return !bad;
      });
    for (const k of Object.keys(shop.storage)) shop.storage[k] = purge(shop.storage[k]);
    for (const o of shop.objects) for (const slot of o.slots ?? []) slot.batches = purge(slot.batches);
    if (lost > 0) {
      toast(`${shop.name}: ${lost} spoiled items thrown away.`, 'warn');
      bus.emit('stock:changed', shop.id);
    }
  }
}

/** Days of freshness left on the oldest batch, or null if it never expires. */
export function freshnessDays(s: GameState, batches: StockBatch[]): number | null {
  const first = batches.find((b) => b.expires > 0);
  return first ? first.expires - dayOf(s.time) : null;
}


/** Units of a product in the back room. */
export const inStorage = (shop: ShopState, product: string): number => batchQty(shop.storage[product]);

/** Whether the back room holds everything a recipe needs, `times` over. */
export function hasIngredients(shop: ShopState, recipe: Record<string, number> | undefined, times = 1): boolean {
  if (!recipe) return true;
  return Object.entries(recipe).every(([p, n]) => inStorage(shop, p) >= n * times);
}

/** Remove a recipe's inputs from the back room. Returns false (and takes nothing) if any are short. */
export function consumeIngredients(shop: ShopState, recipe: Record<string, number> | undefined, times = 1): boolean {
  if (!recipe) return true;
  if (!hasIngredients(shop, recipe, times)) return false;
  for (const [p, n] of Object.entries(recipe)) takeBatches(shop.storage[p], n * times);
  bus.emit('stock:changed', shop.id);
  return true;
}

/** Take up to `qty` units of a product out of the back room. Returns how many were taken. */
export function takeFromStorage(shop: ShopState, product: string, qty: number): number {
  const src = shop.storage[product];
  if (!src) return 0;
  const n = takeBatches(src, qty).reduce((a, b) => a + b.qty, 0);
  if (n) bus.emit('stock:changed', shop.id);
  return n;
}
