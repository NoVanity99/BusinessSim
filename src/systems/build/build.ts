import { bus, toast } from '../../core/events';
import { money } from '../../core/format';
import { session, shopOnLot, type GameState } from '../../core/state';
import { DIFFICULTIES, ECONOMY, FURNITURE, PRODUCTS, SHOP_TYPES } from '../../data';
import {
  emptyStats, inLot, lotIndex, objectAt, objectTiles, WALL_DOOR, WALL_NONE, WALL_SOLID,
  type PlacedObject, type ShopState,
} from '../../entities/Shop';
import { T, type LotDef } from '../city/generate';
import { earn, tryPay } from '../economy/finance';
import { marketPrice, roundPrice } from '../economy/market';
import { emptyObject, newSlots } from '../economy/stock';

const costMult = (s: GameState): number => DIFFICULTIES[s.difficulty].costMult;
export const buildCost = (s: GameState, defId: string): number => Math.round(FURNITURE[defId].cost * costMult(s));
export const sellValue = (s: GameState, defId: string): number => {
  const d = FURNITURE[defId];
  const share = d.category === 'structure' ? ECONOMY.build.structureRefundShare : ECONOMY.build.sellBackShare;
  return Math.round(buildCost(s, defId) * share);
};

/** Cost of the starter shell: floor everywhere, walls around the edge, one door. */
export function shellCost(s: GameState, lot: LotDef, typeId: string): number {
  const type = SHOP_TYPES[typeId];
  const rows = type.shellDepth ? Math.max(4, Math.round(lot.h * type.shellDepth)) : lot.h;
  const perimeter = 2 * (lot.w + rows) - 4;
  const outside = (lot.h - rows) * lot.w * buildCost(s, type.forecourtFloor ?? type.defaultFloor);
  return rows * lot.w * buildCost(s, type.defaultFloor) + outside + (perimeter - 1) * buildCost(s, 'wall') + buildCost(s, 'door');
}

export function setupCost(s: GameState, lot: LotDef, typeId: string): number {
  return Math.round(SHOP_TYPES[typeId].licenseCost * costMult(s)) + shellCost(s, lot, typeId);
}

/** Open a new business on a lot the player holds, with a basic walled shell. */
export function createShop(s: GameState, lot: LotDef, typeId: string): ShopState | null {
  const type = SHOP_TYPES[typeId];
  if (!s.lots[lot.id] || shopOnLot(s, lot.id)) return null;
  if (s.level < type.unlockLevel) {
    toast(`${type.name} unlocks at level ${type.unlockLevel}.`, 'bad');
    return null;
  }
  if (lot.w * lot.h < type.minArea) {
    toast(`A ${type.name} needs at least ${type.minArea} tiles.`, 'bad');
    return null;
  }
  const cost = setupCost(s, lot, typeId);
  if (!tryPay(s, cost, 'construction')) {
    toast(`You need ${money(cost)} to set up a ${type.name}.`, 'bad');
    return null;
  }

  const n = lot.w * lot.h;
  // The building sits at the back of the lot. Some businesses (gas stations) keep an open forecourt in front.
  const rows = type.shellDepth ? Math.max(4, Math.round(lot.h * type.shellDepth)) : lot.h;
  const top = lot.front === 'n' ? lot.h - rows : 0;
  const floor = new Array<string>(n).fill(type.forecourtFloor ?? type.defaultFloor);
  const wall = new Array<number>(n).fill(WALL_NONE);
  for (let y = top; y < top + rows; y++) {
    for (let x = 0; x < lot.w; x++) {
      floor[y * lot.w + x] = type.defaultFloor;
      if (x === 0 || y === top || x === lot.w - 1 || y === top + rows - 1) wall[y * lot.w + x] = WALL_SOLID;
    }
  }
  const doorX = Math.floor(lot.w / 2);
  wall[(lot.front === 'n' ? top : top + rows - 1) * lot.w + doorX] = WALL_DOOR;

  const prices: Record<string, number> = {};
  for (const p of type.products) if (PRODUCTS[p].market > 0) prices[p] = roundPrice(marketPrice(s, p));

  const count = s.shops.filter((sh) => sh.type === typeId).length;
  const shop: ShopState = {
    id: s.nextShopId++,
    lotId: lot.id,
    type: typeId,
    name: count ? `${type.name} #${count + 1}` : type.name,
    hours: [...type.defaultHours],
    closed: false,
    floor,
    wall,
    objects: [],
    nextObjectId: 1,
    storage: {},
    prices,
    reputation: 50,
    dirt: 0,
    autoReorder: true,
    today: emptyStats(),
    yesterday: emptyStats(),
    history: [],
    reviews: [],
  };
  s.shops.push(shop);
  toast(`${shop.name} is set up. Furnish it from the Build tab; the Overview tab lists what is still missing.`, "good");
  bus.emit('shop:created', shop.id);
  bus.emit('shop:changed', shop.id);
  bus.emit('lot:changed', lot.id);
  return shop;
}

/** Sell off everything and close the business. Stock is liquidated at a loss. */
export function closeShop(s: GameState, shop: ShopState): void {
  let refund = 0;
  for (const o of shop.objects) {
    emptyObject(shop, o);
    refund += sellValue(s, o.def);
  }
  for (const [product, batches] of Object.entries(shop.storage)) {
    const qty = batches.reduce((a, b) => a + b.qty, 0);
    refund += qty * PRODUCTS[product].wholesale * 0.3;
  }
  earn(s, Math.round(refund), 'refund');
  s.orders = s.orders.filter((o) => o.shopId !== shop.id);
  if (s.ownerAt?.shopId === shop.id) s.ownerAt = null;
  s.shops.splice(s.shops.indexOf(shop), 1);
  toast(`${shop.name} closed. Recovered ${money(Math.round(refund))} from equipment and stock.`, 'info');
  bus.emit('shop:removed', shop.id);
  bus.emit('lot:changed', shop.lotId);
  bus.emit('orders:changed');
}

// ---------- Objects ----------

export type PlaceCheck = { ok: true } | { ok: false; reason: string };

export function checkPlace(shop: ShopState, lot: LotDef, defId: string, x: number, y: number, rot: number, ignoreId?: number): PlaceCheck {
  const type = SHOP_TYPES[shop.type];
  if (!type.furniture.includes(defId)) return { ok: false, reason: `Not available in a ${type.name}` };
  if (FURNITURE[defId].anywhere) return checkStreetPlace(x, y);
  for (const t of objectTiles({ def: defId, x, y, rot })) {
    if (!inLot(lot, t.x, t.y)) return { ok: false, reason: 'Outside your lot' };
    const i = lotIndex(lot, t.x, t.y);
    if (shop.wall[i] !== WALL_NONE) return { ok: false, reason: 'A wall is in the way' };
    if (!shop.floor[i]) return { ok: false, reason: 'Needs a floor' };
    const other = objectAt(shop, t.x, t.y);
    if (other && other.id !== ignoreId) return { ok: false, reason: 'Space is occupied' };
  }
  return { ok: true };
}

/** Vending machines go on any pavement tile in the city that is not already taken. */
function checkStreetPlace(x: number, y: number): PlaceCheck {
  const { city, state } = session;
  if (x < 0 || y < 0 || x >= city.w || y >= city.h || city.tiles[y * city.w + x] !== T.Sidewalk) return { ok: false, reason: 'Place it on a pavement' };
  for (const other of state.shops) if (other.objects.some((o) => o.x === x && o.y === y && FURNITURE[o.def].anywhere)) return { ok: false, reason: 'There is already a machine here' };
  return { ok: true };
}

export function placeObject(s: GameState, shop: ShopState, lot: LotDef, defId: string, x: number, y: number, rot: number): PlacedObject | null {
  const check = checkPlace(shop, lot, defId, x, y, rot);
  if (!check.ok) return null;
  const cost = buildCost(s, defId);
  if (!tryPay(s, cost, 'construction')) {
    toast(`You need ${money(cost)} for a ${FURNITURE[defId].name}.`, 'bad');
    return null;
  }
  const obj: PlacedObject = { id: shop.nextObjectId++, def: defId, x, y, rot, slots: newSlots(defId) };
  if (FURNITURE[defId].kind === 'producer') obj.recipe = null;
  if (FURNITURE[defId].kind === 'vending') obj.cash = 0;
  shop.objects.push(obj);
  bus.emit('stat', { stat: 'built' });
  // The first checkout gets the owner behind it so a new shop can trade straight away.
  if (FURNITURE[defId].kind === 'register' && !s.ownerAt) s.ownerAt = { shopId: shop.id, objectId: obj.id };
  bus.emit('shop:changed', shop.id);
  return obj;
}

export function moveObject(shop: ShopState, lot: LotDef, obj: PlacedObject, x: number, y: number, rot: number): boolean {
  if (!checkPlace(shop, lot, obj.def, x, y, rot, obj.id).ok) return false;
  obj.x = x;
  obj.y = y;
  obj.rot = rot;
  bus.emit('shop:changed', shop.id);
  return true;
}

export function sellObject(s: GameState, shop: ShopState, obj: PlacedObject): void {
  emptyObject(shop, obj);
  earn(s, sellValue(s, obj.def), 'refund');
  shop.objects.splice(shop.objects.indexOf(obj), 1);
  if (s.ownerAt?.shopId === shop.id && s.ownerAt.objectId === obj.id) s.ownerAt = null;
  bus.emit('shop:changed', shop.id);
  bus.emit('stock:changed', shop.id);
}

// ---------- Structure (floors, walls, doors) ----------

/**
 * Apply a structure piece to one tile. Returns true if anything changed.
 * Emits nothing; callers batch a drag and emit 'shop:changed' once.
 */
export function paintStructure(s: GameState, shop: ShopState, lot: LotDef, defId: string, x: number, y: number): boolean {
  if (!inLot(lot, x, y)) return false;
  const d = FURNITURE[defId];
  const i = lotIndex(lot, x, y);
  const cost = buildCost(s, defId);

  if (d.kind === 'floor') {
    if (shop.floor[i] === defId) return false;
    if (!tryPay(s, cost, 'construction')) return false;
    shop.floor[i] = defId;
    return true;
  }
  const target = d.kind === 'door' ? WALL_DOOR : WALL_SOLID;
  if (shop.wall[i] === target || objectAt(shop, x, y)) return false;
  if (!shop.floor[i]) return false;
  if (!tryPay(s, cost, 'construction')) return false;
  shop.wall[i] = target;
  return true;
}

/** Knock down a wall or door on one tile, with a partial refund. */
export function removeWall(s: GameState, shop: ShopState, lot: LotDef, x: number, y: number): boolean {
  if (!inLot(lot, x, y)) return false;
  const i = lotIndex(lot, x, y);
  if (shop.wall[i] === WALL_NONE) return false;
  earn(s, sellValue(s, shop.wall[i] === WALL_DOOR ? 'door' : 'wall'), 'refund');
  shop.wall[i] = WALL_NONE;
  return true;
}
