import { bus } from '../src/core/events';
import { createNewGame, session, type GameState } from '../src/core/state';
import { PRODUCTS, SHOP_TYPES } from '../src/data';
import type { ShopState } from '../src/entities/Shop';
import { createShop, placeObject } from '../src/systems/build/build';
import { generateCity, type LotDef } from '../src/systems/city/generate';
import { rentLot } from '../src/systems/economy/property';
import { addToStorage, assignSlot, fillObject } from '../src/systems/economy/stock';
import { addXp } from '../src/systems/progress/level';
import { installSim, stepSimulation } from '../src/systems/sim';

let uninstall: (() => void) | null = null;

/** Bring the simulation up around whatever is in `session.state`, as the city scene does. */
export function bootSimulation(): void {
  uninstall?.();
  bus.clear();
  uninstall = installSim();
}

/** A fresh company with plenty of cash and every business unlocked. */
export function startGame(money = 500_000): GameState {
  session.state = createNewGame({ companyName: 'Test Co', difficulty: 'normal' });
  session.city = generateCity();
  session.state.money = money;
  bootSimulation();
  addXp(session.state, 50_000);
  return session.state;
}

/** Run the simulation for a number of game minutes at 4x speed, in frame-sized steps. */
export function run(gameMinutes: number): void {
  const s = session.state;
  s.time.speed = 4;
  const until = s.time.minutes + gameMinutes;
  while (s.time.minutes < until) stepSimulation(0.1);
}

export function setClock(hour: number): void {
  const t = session.state.time;
  t.minutes = Math.floor(t.minutes / 1440) * 1440 + hour * 60;
}

/** A free lot that faces south (so layouts read top to bottom) and suits the business. */
export function findLot(typeId: string, district?: string): LotDef {
  const s = session.state;
  const min = SHOP_TYPES[typeId].minArea;
  const fits = session.city.lots.filter((l) => l.rentable && !s.lots[l.id] && l.front === 's' && l.w >= 8 && l.w * l.h >= Math.max(min, 64));
  // The district is a preference: busy areas have few lots, and a test should not fail for want of one.
  const lot = fits.find((l) => l.district === district) ?? fits[0];
  if (!lot) throw new Error(`No free lot for ${typeId}`);
  return lot;
}

/**
 * Open a business and furnish it. `items` are [furniture id, dx, dy, rotation] relative
 * to the lot's top-left corner; `stock` goes straight into the back room.
 */
export function openShop(typeId: string, items: [string, number, number, number][], stock: Record<string, number> = {}, district?: string): ShopState {
  const s = session.state;
  const lot = findLot(typeId, district);
  if (!rentLot(s, lot)) throw new Error('rent failed');
  const shop = createShop(s, lot, typeId);
  if (!shop) throw new Error(`could not open ${typeId}`);
  for (const [def, dx, dy, rot] of items) {
    if (!placeObject(s, shop, lot, def, lot.x + dx, lot.y + dy, rot)) throw new Error(`could not place ${def} at ${dx},${dy} in ${typeId}`);
  }
  for (const [product, qty] of Object.entries(stock)) {
    if (!PRODUCTS[product]) throw new Error(`unknown product ${product}`);
    addToStorage(shop, product, qty, 0);
  }
  return shop;
}

/** Put products on a shop's shelves: one list of products per shelf-like object, in placement order. */
export function stockShelves(shop: ShopState, layout: string[][]): void {
  const shelves = shop.objects.filter((o) => o.slots);
  layout.forEach((products, i) => {
    products.forEach((p, slot) => assignSlot(shop, shelves[i], slot, p));
    fillObject(shop, shelves[i]);
  });
}
