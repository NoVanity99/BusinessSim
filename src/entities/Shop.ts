import { FURNITURE, SHOP_TYPES, type FurnitureDef } from '../data';
import type { LotDef } from '../systems/city/generate';

/** A quantity of one product that expires together. `expires` is a day number; 0 = never. */
export interface StockBatch {
  qty: number;
  expires: number;
}

export interface ShelfSlot {
  product: string | null;
  batches: StockBatch[];
}

export const WALL_NONE = 0;
export const WALL_SOLID = 1;
export const WALL_DOOR = 2;

/** A piece of furniture placed in a shop. Coordinates are global map tiles (top-left of footprint). */
export interface PlacedObject {
  id: number;
  def: string;
  x: number;
  y: number;
  /** 0 = faces south, 1 = west, 2 = north, 3 = east. */
  rot: number;
  slots?: ShelfSlot[];
  /** Out of order until repaired. */
  broken?: boolean;
  /** Producer: what it is set to make, and minutes of progress on the current batch. */
  recipe?: string | null;
  progress?: number;
  /** Vending machine: takings waiting to be collected. */
  cash?: number;
}

export interface ShopDayStats {
  customers: number;
  served: number;
  walkouts: number;
  revenue: number;
  unitsSold: number;
  /** Stock orders, wages, rent and utilities attributed to this shop. */
  costs: number;
}

export interface ShopState {
  id: number;
  lotId: number;
  type: string;
  name: string;
  /** Opening hours [from, to) in whole hours. */
  hours: [number, number];
  /** Manually closed by the player. */
  closed: boolean;
  /** Per lot tile (row-major, lot-local): floor furniture id or '' for bare ground. */
  floor: string[];
  /** Per lot tile: WALL_NONE / WALL_SOLID / WALL_DOOR. */
  wall: number[];
  objects: PlacedObject[];
  nextObjectId: number;
  /** Back-room stock per product. */
  storage: Record<string, StockBatch[]>;
  /** Player-set retail prices per product. */
  prices: Record<string, number>;
  /** 0-100. */
  reputation: number;
  /** 0 (spotless) to 100 (filthy). */
  dirt: number;
  /** Let a manager on shift reorder stock. */
  autoReorder: boolean;
  /** Day number of a scheduled tournament or promotion, if any. */
  eventDay?: number;
  /** Factory: sell finished goods to the wholesale market as they are made. */
  autoSell?: boolean;
  /** Extra storage from upgrades. */
  storageBonus?: number;
  /** Running average of how visitors felt on leaving, 0-100. */
  moodAvg?: number;
  today: ShopDayStats;
  yesterday: ShopDayStats;
  /** Closed days, oldest first, capped at SHOP_HISTORY_DAYS. */
  history: ShopDayRecord[];
}

export interface ShopDayRecord extends ShopDayStats {
  day: number;
}

export const SHOP_HISTORY_DAYS = 120;

export const emptyStats = (): ShopDayStats => ({ customers: 0, served: 0, walkouts: 0, revenue: 0, unitsSold: 0, costs: 0 });

export const DIRS = [
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
  { x: 1, y: 0 },
] as const;

export const defOf = (o: PlacedObject): FurnitureDef => FURNITURE[o.def];

export function footprint(defId: string, rot: number): { w: number; h: number } {
  const d = FURNITURE[defId];
  const w = d.w ?? 1;
  const h = d.h ?? 1;
  return rot % 2 === 0 ? { w, h } : { w: h, h: w };
}

export function objectTiles(o: { def: string; x: number; y: number; rot: number }): { x: number; y: number }[] {
  const { w, h } = footprint(o.def, o.rot);
  const out: { x: number; y: number }[] = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push({ x: o.x + dx, y: o.y + dy });
  return out;
}

/** Tiles where a customer stands to use the object (the row along its front face). */
export function frontTiles(o: { def: string; x: number; y: number; rot: number }): { x: number; y: number }[] {
  const { w, h } = footprint(o.def, o.rot);
  const out: { x: number; y: number }[] = [];
  switch (o.rot % 4) {
    case 0: for (let i = 0; i < w; i++) out.push({ x: o.x + i, y: o.y + h }); break;
    case 2: for (let i = 0; i < w; i++) out.push({ x: o.x + i, y: o.y - 1 }); break;
    case 1: for (let j = 0; j < h; j++) out.push({ x: o.x - 1, y: o.y + j }); break;
    default: for (let j = 0; j < h; j++) out.push({ x: o.x + w, y: o.y + j });
  }
  return out;
}

/** Tile behind a 1x1 object, where its operator stands. */
export function backTile(o: PlacedObject): { x: number; y: number } {
  const d = DIRS[o.rot % 4];
  return { x: o.x - d.x, y: o.y - d.y };
}

export const lotIndex = (lot: LotDef, x: number, y: number): number => (y - lot.y) * lot.w + (x - lot.x);
export const inLot = (lot: LotDef, x: number, y: number): boolean => x >= lot.x && y >= lot.y && x < lot.x + lot.w && y < lot.y + lot.h;

export function objectAt(shop: ShopState, x: number, y: number): PlacedObject | undefined {
  for (const o of shop.objects) {
    const { w, h } = footprint(o.def, o.rot);
    if (x >= o.x && y >= o.y && x < o.x + w && y < o.y + h) return o;
  }
  return undefined;
}

export const batchQty = (batches: StockBatch[] | undefined): number => (batches ? batches.reduce((a, b) => a + b.qty, 0) : 0);

/** `bonus` is extra capacity from upgrades, supplied by callers that know the game state. */
export function storageCapacity(shop: ShopState, bonus = shop.storageBonus ?? 0): number {
  let cap = SHOP_TYPES[shop.type].baseStorage + bonus;
  for (const o of shop.objects) cap += defOf(o).storage ?? 0;
  return cap;
}

export function storageUsed(shop: ShopState): number {
  let n = 0;
  for (const k in shop.storage) n += batchQty(shop.storage[k]);
  return n;
}

/** Units of a product on display across all shelves. */
export function shelfQty(shop: ShopState, product: string): number {
  let n = 0;
  for (const o of shop.objects) {
    if (!o.slots) continue;
    for (const s of o.slots) if (s.product === product) n += batchQty(s.batches);
  }
  return n;
}

export const registers = (shop: ShopState): PlacedObject[] => shop.objects.filter((o) => defOf(o).kind === 'register');
export const doors = (shop: ShopState, lot: LotDef): { x: number; y: number }[] => {
  const out: { x: number; y: number }[] = [];
  shop.wall.forEach((w, i) => {
    if (w === WALL_DOOR) out.push({ x: lot.x + (i % lot.w), y: lot.y + Math.floor(i / lot.w) });
  });
  return out;
};

/** Sum of decor scores, used for customer mood. Includes flooring. */
export function decorScore(shop: ShopState): number {
  let score = 0;
  for (const o of shop.objects) score += defOf(o).decor;
  let floorSum = 0;
  let floorCount = 0;
  for (const f of shop.floor) {
    if (!f) continue;
    floorSum += FURNITURE[f].decor;
    floorCount++;
  }
  // Floors count by average quality so big shops are not automatically prettier.
  if (floorCount) score += (floorSum / floorCount) * 4;
  return score;
}
