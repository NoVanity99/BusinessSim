import { bus, toast } from '../../core/events';
import { money } from '../../core/format';
import { session, shopById, type GameState } from '../../core/state';
import { FURNITURE } from '../../data';
import type { PlacedObject, ShopState } from '../../entities/Shop';
import { earn, tryPay } from '../economy/finance';
import { assignSlot, emptyObject, newSlots } from '../economy/stock';
import { checkPlace, moveObject, sellObject } from './build';

/**
 * Undo and redo for building. Every build action is recorded as an operation that knows
 * how to reverse itself: undoing a purchase gives the full price back, undoing a sale
 * buys the piece back for what you got. History is per shop and lasts for the session.
 */
export interface ObjSnap {
  id: number;
  def: string;
  x: number;
  y: number;
  rot: number;
  /** What each shelf section was set to display. */
  products?: (string | null)[];
  recipe?: string | null;
}

export type Op =
  | { t: 'place'; obj: ObjSnap; cost: number }
  | { t: 'sell'; obj: ObjSnap; value: number }
  | { t: 'move'; id: number; from: { x: number; y: number; rot: number }; to: { x: number; y: number; rot: number } }
  /** Floors, walls and doors changed on some tiles. `cost` is what it cost in total (negative if it paid out). */
  | { t: 'paint'; tiles: { i: number; f0: string; w0: number; f1: string; w1: number }[]; cost: number }
  | { t: 'batch'; ops: Op[]; label: string };

const MAX_HISTORY = 60;
const stacks = new Map<number, { undo: Op[]; redo: Op[] }>();
const stackOf = (shopId: number): { undo: Op[]; redo: Op[] } => {
  let st = stacks.get(shopId);
  if (!st) stacks.set(shopId, (st = { undo: [], redo: [] }));
  return st;
};

export const snapOf = (o: PlacedObject): ObjSnap => ({ id: o.id, def: o.def, x: o.x, y: o.y, rot: o.rot, products: o.slots?.map((sl) => sl.product), recipe: o.recipe });

/** Remember something the player just did, so it can be undone. */
export function record(shopId: number, op: Op): void {
  if (op.t === 'batch' && !op.ops.length) return;
  if (op.t === 'paint' && !op.tiles.length) return;
  const st = stackOf(shopId);
  st.undo.push(op);
  if (st.undo.length > MAX_HISTORY) st.undo.shift();
  st.redo.length = 0;
  bus.emit('build:history', shopId);
}

export const canUndo = (shopId: number): boolean => stackOf(shopId).undo.length > 0;
export const canRedo = (shopId: number): boolean => stackOf(shopId).redo.length > 0;
export function clearHistory(shopId?: number): void {
  if (shopId === undefined) stacks.clear();
  else stacks.delete(shopId);
}

/** Put a piece back exactly as it was, keeping its id so later operations still refer to it. */
function restore(s: GameState, shop: ShopState, snap: ObjSnap, charge: number): string | null {
  const lot = session.city.lots[shop.lotId];
  if (shop.objects.some((o) => o.id === snap.id)) return null;
  const check = checkPlace(shop, lot, snap.def, snap.x, snap.y, snap.rot);
  if (!check.ok) return check.reason;
  if (charge > 0 && !tryPay(s, charge, 'construction')) return `You need ${money(charge)}`;
  const obj: PlacedObject = { id: snap.id, def: snap.def, x: snap.x, y: snap.y, rot: snap.rot, slots: newSlots(snap.def) };
  if (FURNITURE[snap.def].kind === 'producer') obj.recipe = snap.recipe ?? null;
  if (FURNITURE[snap.def].kind === 'vending') obj.cash = 0;
  shop.objects.push(obj);
  shop.nextObjectId = Math.max(shop.nextObjectId, snap.id + 1);
  snap.products?.forEach((p, i) => p && assignSlot(shop, obj, i, p));
  if (FURNITURE[snap.def].kind === 'register' && !s.ownerAt) s.ownerAt = { shopId: shop.id, objectId: obj.id };
  return null;
}

/** Take a piece away again and give back what was paid for it. */
function remove(s: GameState, shop: ShopState, id: number, refund: number): string | null {
  const obj = shop.objects.find((o) => o.id === id);
  if (!obj) return null;
  emptyObject(shop, obj);
  shop.objects.splice(shop.objects.indexOf(obj), 1);
  if (s.ownerAt?.shopId === shop.id && s.ownerAt.objectId === id) s.ownerAt = null;
  if (refund > 0) earn(s, refund, 'refund');
  return null;
}

/** Apply an operation forwards (redo) or backwards (undo). Returns a reason if it could not be done. */
function apply(s: GameState, shop: ShopState, op: Op, back: boolean): string | null {
  const lot = session.city.lots[shop.lotId];
  switch (op.t) {
    case 'place':
      return back ? remove(s, shop, op.obj.id, op.cost) : restore(s, shop, op.obj, op.cost);
    case 'sell': {
      if (back) return restore(s, shop, op.obj, op.value);
      const obj = shop.objects.find((o) => o.id === op.obj.id);
      if (obj) sellObject(s, shop, obj);
      return null;
    }
    case 'move': {
      const obj = shop.objects.find((o) => o.id === op.id);
      const to = back ? op.from : op.to;
      if (!obj) return 'That piece is gone';
      return moveObject(shop, lot, obj, to.x, to.y, to.rot) ? null : 'Something is in the way';
    }
    case 'paint': {
      const amount = back ? -op.cost : op.cost;
      if (amount > 0 && !tryPay(s, amount, 'construction')) return `You need ${money(amount)}`;
      if (amount < 0) earn(s, -amount, 'refund');
      for (const t of op.tiles) {
        shop.floor[t.i] = back ? t.f0 : t.f1;
        shop.wall[t.i] = back ? t.w0 : t.w1;
      }
      return null;
    }
    case 'batch': {
      const list = back ? [...op.ops].reverse() : op.ops;
      let failed: string | null = null;
      // Do as much as can be done; report the first thing that could not.
      for (const o of list) failed = apply(s, shop, o, back) ?? failed;
      return failed;
    }
  }
}

function step(shopId: number, back: boolean): boolean {
  const s = session.state;
  const shop = shopById(s, shopId);
  const st = stackOf(shopId);
  const op = (back ? st.undo : st.redo).pop();
  if (!shop || !op) return false;
  const failed = apply(s, shop, op, back);
  if (failed && op.t !== 'batch') {
    // Leave it where it was so the player can clear the way and try again.
    (back ? st.undo : st.redo).push(op);
    toast(`Cannot ${back ? 'undo' : 'redo'}: ${failed.toLowerCase()}.`, 'warn');
    return false;
  }
  (back ? st.redo : st.undo).push(op);
  bus.emit('shop:changed', shopId);
  bus.emit('stock:changed', shopId);
  bus.emit('build:history', shopId);
  return true;
}

export const undo = (shopId: number): boolean => step(shopId, true);
export const redo = (shopId: number): boolean => step(shopId, false);
