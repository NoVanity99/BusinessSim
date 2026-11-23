import { bus } from '../../core/events';
import { clamp } from '../../core/format';
import { rand } from '../../core/rng';
import { session, shopById, type GameState } from '../../core/state';
import type { Employee } from '../../entities/Employee';
import { backTile, batchQty, defOf, doors, frontTiles, inLot, objectTiles, registers, type PlacedObject, type ShopState } from '../../entities/Shop';
import { walkable } from '../ai/grid';
import { findPath } from '../ai/pathfind';
import { rt, type StaffAgent } from '../ai/runtime';
import { fillSlot } from '../economy/stock';
import { onDuty, performance, traitSum } from './staff';

const STAFF_SPEED = 3;
const CARRY_UNITS = 14;

const tileOf = (x: number, y: number): number => y * rt.grid.w + x;

function setPath(a: StaffAgent, goal: number): boolean {
  const g = rt.grid;
  const path = findPath(g, Math.floor(a.x), Math.floor(a.y), goal % g.w, Math.floor(goal / g.w));
  if (!path) return false;
  a.path = path.reverse();
  a.goal = goal;
  return true;
}

/** Where a cashier stands to work a checkout: behind it if possible, otherwise beside it. */
export function operatorTile(obj: PlacedObject): number | null {
  const g = rt.grid;
  const front = frontTiles(obj)[0];
  const back = backTile(obj);
  const options = [back, { x: obj.x - 1, y: obj.y }, { x: obj.x + 1, y: obj.y }, { x: obj.x, y: obj.y - 1 }, { x: obj.x, y: obj.y + 1 }];
  const spot = options.find((t) => walkable(g, t.x, t.y) && !(t.x === front.x && t.y === front.y));
  return spot ? tileOf(spot.x, spot.y) : null;
}

/** Which checkout a cashier should take: their assigned one, or any that nobody is running. */
function chooseRegister(s: GameState, shop: ShopState, e: Employee): PlacedObject | undefined {
  const taken = new Set<number>();
  if (s.ownerAt?.shopId === shop.id) taken.add(s.ownerAt.objectId);
  for (const other of s.staff) {
    if (other.id === e.id || other.shopId !== shop.id || other.role !== 'cashier') continue;
    const oa = rt.staff.get(other.id);
    if (oa && oa.stationObj >= 0) taken.add(oa.stationObj);
  }
  const regs = registers(shop).filter((r) => !taken.has(r.id) && operatorTile(r) !== null);
  return regs.find((r) => r.id === e.stationId) ?? regs[0];
}

/** Free floor tiles inside a shop that are not a doorway, checkout line or shelf front. */
function standingTiles(shop: ShopState): number[] {
  const g = rt.grid;
  const lot = session.city.lots[shop.lotId];
  const avoid = new Set<number>();
  for (const d of doors(shop, lot)) avoid.add(tileOf(d.x, d.y));
  for (const reg of rt.registers.values()) if (reg.shopId === shop.id) reg.slots.forEach((t) => avoid.add(t));
  for (const o of shop.objects) if (o.slots) for (const f of frontTiles(o)) avoid.add(tileOf(f.x, f.y));
  const out: number[] = [];
  for (let y = lot.y; y < lot.y + lot.h; y++) {
    for (let x = lot.x; x < lot.x + lot.w; x++) {
      const t = tileOf(x, y);
      if (g.cost[t] === 10 && !avoid.has(t)) out.push(t);
    }
  }
  return out;
}

function nearestDoor(shop: ShopState, a: { x: number; y: number }): number | null {
  const ds = doors(shop, session.city.lots[shop.lotId]);
  if (!ds.length) return null;
  ds.sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y));
  return tileOf(ds[0].x, ds[0].y);
}

function createAgent(shop: ShopState, e: Employee, instant: boolean): StaffAgent | null {
  const lot = session.city.lots[shop.lotId];
  const door = nearestDoor(shop, { x: lot.x + lot.w / 2, y: lot.y + lot.h / 2 });
  const start = door ?? standingTiles(shop)[0];
  if (start === undefined) return null;
  const a: StaffAgent = {
    id: e.id,
    x: (start % rt.grid.w) + 0.5,
    y: Math.floor(start / rt.grid.w) + 0.5,
    path: [],
    goal: start,
    state: 'idle',
    timer: instant ? 0 : rand.range(0, 0.5),
    stationObj: -1,
    taskObj: -1,
    taskSlot: -1,
    activity: 'Starting their shift',
  };
  rt.staff.set(e.id, a);
  return a;
}

function removeAgent(id: number): void {
  if (rt.staff.delete(id)) bus.emit('staff:removed', id);
}

// ---------- Role behaviour ----------

/** Decide what an idle employee does next. */
function plan(s: GameState, shop: ShopState, e: Employee, a: StaffAgent): void {
  const g = rt.grid;
  switch (e.role) {
    case 'cashier': {
      const reg = chooseRegister(s, shop, e);
      const tile = reg ? operatorTile(reg) : null;
      if (!reg || tile === null) {
        a.activity = 'No free checkout to work';
        a.timer = 1;
        return;
      }
      if (tile === tileOf(Math.floor(a.x), Math.floor(a.y))) {
        a.stationObj = reg.id;
        a.state = 'working';
        a.activity = 'Working the checkout';
      } else if (setPath(a, tile)) {
        a.taskObj = reg.id;
        a.state = 'toTask';
        a.activity = 'Walking to the checkout';
      } else a.timer = 1;
      return;
    }
    case 'stocker': {
      // Refill whichever shelf section is emptiest and has stock waiting in the back.
      let best: { obj: PlacedObject; slot: number; fill: number } | null = null;
      for (const obj of shop.objects) {
        if (defOf(obj).kind !== 'shelf') continue;
        obj.slots?.forEach((sl, i) => {
          if (!sl.product || batchQty(shop.storage[sl.product]) <= 0) return;
          const cap = defOf(obj).slotCapacity ?? 1;
          const fill = batchQty(sl.batches) / cap;
          if (fill < 0.75 && (!best || fill < best.fill)) best = { obj, slot: i, fill };
        });
      }
      const job = best as { obj: PlacedObject; slot: number; fill: number } | null;
      if (job) {
        const spots = frontTiles(job.obj).filter((t) => walkable(g, t.x, t.y));
        if (spots.length && setPath(a, tileOf(spots[0].x, spots[0].y))) {
          a.taskObj = job.obj.id;
          a.taskSlot = job.slot;
          a.state = 'toTask';
          a.activity = 'Restocking shelves';
          return;
        }
      }
      if (shop.objects.some((o) => defOf(o).kind === 'producer')) {
        a.activity = 'Running the machines';
        a.state = 'working';
        a.timer = 10;
        return;
      }
      a.activity = 'Waiting for shelves to restock';
      a.timer = 1.5;
      return;
    }
    case 'cook': {
      // Stand at a cooking station; the kitchen system does the actual cooking.
      const station = shop.objects.find((o) => defOf(o).kind === 'cookstation' && !o.broken && operatorTile(o) !== null && ![...rt.staff.values()].some((x) => x.id !== a.id && x.taskObj === o.id));
      const tile = station ? operatorTile(station) : null;
      if (!station || tile === null) {
        a.state = 'working';
        a.timer = 5;
        a.activity = 'Cooking';
        return;
      }
      a.taskObj = station.id;
      a.activity = 'Cooking';
      if (tile === tileOf(Math.floor(a.x), Math.floor(a.y))) {
        a.state = 'working';
        a.timer = 20;
      } else if (setPath(a, tile)) a.state = 'toTask';
      else a.timer = 1;
      return;
    }
    case 'mechanic': {
      const broken = shop.objects.find((o) => o.broken);
      if (broken) {
        const spots = objectTiles(broken).flatMap((t) => [[t.x + 1, t.y], [t.x - 1, t.y], [t.x, t.y + 1], [t.x, t.y - 1]]).filter(([x, y]) => walkable(g, x, y));
        if (spots.length && setPath(a, tileOf(spots[0][0], spots[0][1]))) {
          a.taskObj = broken.id;
          a.state = 'toTask';
          a.activity = `Repairing the ${defOf(broken).name.toLowerCase()}`;
          return;
        }
      }
      a.activity = 'Keeping the machines running';
      a.state = 'working';
      a.timer = 3;
      return;
    }
    case 'cleaner': {
      const tiles = standingTiles(shop);
      if (tiles.length && setPath(a, rand.pick(tiles))) {
        a.state = 'toTask';
        a.activity = shop.dirt > 5 ? 'Cleaning' : 'Looking for something to clean';
      } else a.timer = 2;
      return;
    }
    default: {
      // Managers, guards and anyone without a specific station find a spot and keep watch.
      const tiles = standingTiles(shop);
      const door = nearestDoor(shop, a);
      let tile = tiles[(e.id * 7) % Math.max(1, tiles.length)];
      if (e.role === 'security' && door !== null && tiles.length) {
        const dx = door % g.w;
        const dy = Math.floor(door / g.w);
        tile = tiles.slice().sort((p, q) => Math.hypot((p % g.w) - dx, Math.floor(p / g.w) - dy) - Math.hypot((q % g.w) - dx, Math.floor(q / g.w) - dy))[Math.min(2, tiles.length - 1)];
      }
      a.activity = e.role === 'manager' ? 'Managing the shop' : e.role === 'security' ? 'Watching the door' : 'On shift';
      if (tile !== undefined && tile !== tileOf(Math.floor(a.x), Math.floor(a.y)) && setPath(a, tile)) a.state = 'toTask';
      else {
        a.state = 'working';
        a.timer = 30;
      }
    }
  }
}

function arrive(e: Employee, a: StaffAgent): void {
  if (a.state === 'leaving') return removeAgent(e.id);
  switch (e.role) {
    case 'cashier':
      a.stationObj = a.taskObj;
      a.state = 'working';
      a.activity = 'Working the checkout';
      return;
    case 'stocker':
      a.state = 'working';
      a.timer = 0.9 / performance(e);
      return;
    case 'cleaner':
      a.state = 'working';
      a.timer = rand.range(1.5, 3);
      return;
    case 'mechanic':
      a.state = 'working';
      a.timer = 8 / performance(e);
      return;
    case 'cook':
      a.state = 'working';
      a.timer = 20;
      return;
    default:
      a.state = 'working';
      a.timer = 30;
  }
}

function finishWork(shop: ShopState, e: Employee, a: StaffAgent): void {
  const obj = shop.objects.find((o) => o.id === a.taskObj);
  if (e.role === 'stocker') {
    if (obj?.slots) fillSlot(shop, obj, a.taskSlot, Math.round(CARRY_UNITS * traitSum(e, 'carry')));
    a.taskObj = -1;
  } else if (e.role === 'mechanic') {
    if (obj?.broken) {
      obj.broken = false;
      bus.emit('shop:changed', shop.id);
    }
    a.taskObj = -1;
  }
  a.state = 'idle';
  a.timer = 0.2;
}

/** Advance all staff by `dt` game minutes and make sure the right people are on site. */
export function updateStaff(dt: number): void {
  if (dt <= 0) return;
  const s = session.state;
  const g = rt.grid;

  for (const e of s.staff) {
    const shop = e.shopId !== null ? shopById(s, e.shopId) : undefined;
    let a = rt.staff.get(e.id);
    const due = !!shop && onDuty(s, e);
    if (!shop || (!due && !a)) {
      if (a) removeAgent(e.id);
      continue;
    }
    if (due && !a) a = createAgent(shop, e, false) ?? undefined;
    if (!a) continue;

    if (!due && a.state !== 'leaving') {
      // Shift over: head for the door.
      const door = nearestDoor(shop, a);
      a.stationObj = -1;
      a.activity = 'Going home';
      if (door === null || !setPath(a, door)) {
        removeAgent(e.id);
        continue;
      }
      a.state = 'leaving';
    }

    // Cleaners clean wherever they are; the rest is movement and timers.
    if (e.role === 'cleaner' && due) shop.dirt = clamp(shop.dirt - dt * 0.14 * performance(e), 0, 100);

    if (a.state === 'idle') {
      a.timer -= dt;
      if (a.timer <= 0) plan(s, shop, e, a);
      continue;
    }
    if (a.state === 'working') {
      if (e.role === 'cashier') {
        // If their checkout was sold or the owner took it over, find another.
        const still = shop.objects.some((o) => o.id === a.stationObj) && !(s.ownerAt?.shopId === shop.id && s.ownerAt.objectId === a.stationObj);
        if (!still) {
          a.stationObj = -1;
          a.state = 'idle';
          a.timer = 0;
        }
        continue;
      }
      a.timer -= dt;
      if (a.timer <= 0) finishWork(shop, e, a);
      continue;
    }

    let dist = STAFF_SPEED * dt;
    while (dist > 0 && a.path.length) {
      const n = a.path[a.path.length - 1];
      if (g.cost[n] === 0) {
        if (!setPath(a, a.goal)) {
          a.path = [];
          a.state = a.state === 'leaving' ? 'leaving' : 'idle';
          a.timer = 0.5;
        }
        break;
      }
      const tx = (n % g.w) + 0.5;
      const ty = Math.floor(n / g.w) + 0.5;
      const d = Math.hypot(tx - a.x, ty - a.y);
      if (d <= dist) {
        a.x = tx;
        a.y = ty;
        a.path.pop();
        dist -= d;
      } else {
        a.x += ((tx - a.x) / d) * dist;
        a.y += ((ty - a.y) / d) * dist;
        dist = 0;
      }
    }
    if (!a.path.length && (a.state === 'toTask' || a.state === 'leaving' || a.state === 'arriving')) arrive(e, a);
  }

  // Drop agents whose employee was fired or whose shop closed.
  for (const id of rt.staff.keys()) if (!s.staff.some((e) => e.id === id)) removeAgent(id);
}

/** After a layout change, staff re-plan so nobody is stranded inside a new wall. */
export function staffLayoutChanged(shopId: number): void {
  const s = session.state;
  const shop = shopById(s, shopId);
  for (const e of s.staff) {
    if (e.shopId !== shopId) continue;
    const a = rt.staff.get(e.id);
    if (!a) continue;
    if (!shop) {
      removeAgent(e.id);
      continue;
    }
    const lot = session.city.lots[shop.lotId];
    // Standing inside something that was just built: step to the nearest free tile.
    if (!walkable(rt.grid, Math.floor(a.x), Math.floor(a.y)) || !inLot(lot, Math.floor(a.x), Math.floor(a.y))) {
      const free = standingTiles(shop)[0];
      if (free !== undefined) {
        a.x = (free % rt.grid.w) + 0.5;
        a.y = Math.floor(free / rt.grid.w) + 0.5;
      }
    }
    if (a.state !== 'leaving') {
      a.path = [];
      a.stationObj = -1;
      a.state = 'idle';
      a.timer = 0;
    }
  }
}

/** The employee running a checkout right now, if any. */
export function cashierAt(s: GameState, shopId: number, objectId: number): Employee | undefined {
  for (const e of s.staff) {
    if (e.shopId !== shopId || e.role !== 'cashier') continue;
    const a = rt.staff.get(e.id);
    if (a && a.state === 'working' && a.stationObj === objectId) return e;
  }
  return undefined;
}
