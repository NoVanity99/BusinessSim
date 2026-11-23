import { bus } from '../../core/events';
import { clamp } from '../../core/format';
import { rand } from '../../core/rng';
import { session, shopById, type GameState } from '../../core/state';
import { EMPLOYEES, SHOP_TYPES } from '../../data';
import type { Employee } from '../../entities/Employee';
import { backTile, batchQty, defOf, doors, frontTiles, inLot, objectTiles, registers, type PlacedObject, type ShopState } from '../../entities/Shop';
import { walkable } from '../ai/grid';
import { findPath } from '../ai/pathfind';
import { regKey, rt, type StaffAgent } from '../ai/runtime';
import { fillSlot } from '../economy/stock';
import { hasTrait, onDuty, performance, traitSum } from './staff';

/**
 * Staff on the shop floor.
 *
 * Every role has an ordered list of tasks (editable per shop on the task board). An
 * employee with nothing in hand takes the first task on their list that has work waiting:
 * a cashier serves while there are customers, restocks when the shop is empty, and cleans
 * when the shelves are full. With nothing at all to do they return to their post, take a
 * break if tired, or chat with a colleague.
 */
const STAFF_SPEED = 3;
const CARRY_UNITS = 14;
/** Minutes between looking up from a standing task to see whether something more important has come up. */
const RECHECK_MINUTES = 1;
const BREAK_BELOW_ENERGY = 30;
const BREAK_MINUTES = 12;
const BREAK_COOLDOWN = 150;

export const TASK_NAMES: Record<string, string> = {
  serve: 'Serve customers',
  restock: 'Restock shelves',
  clean: 'Clean',
  cook: 'Cook orders',
  repair: 'Repair machines',
  guard: 'Watch for thieves',
  manage: 'Manage',
  operate: 'Run machines',
};

/** The order in which a role works through its tasks in a shop: the player's, or the default from data. */
export function prioritiesOf(shop: ShopState, role: string): string[] {
  const defaults = EMPLOYEES.roles[role]?.tasks ?? [];
  const custom = shop.priorities?.[role];
  // Tolerate saved lists that predate a task being added or removed.
  if (!custom) return defaults;
  return [...custom.filter((t) => defaults.includes(t)), ...defaults.filter((t) => !custom.includes(t))];
}

export function movePriority(shop: ShopState, role: string, task: string, dir: -1 | 1): void {
  const list = [...prioritiesOf(shop, role)];
  const i = list.indexOf(task);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  (shop.priorities ??= {})[role] = list;
  bus.emit('staff:changed');
}

const tileOf = (x: number, y: number): number => y * rt.grid.w + x;
const here = (a: StaffAgent): number => tileOf(Math.floor(a.x), Math.floor(a.y));

function setPath(a: StaffAgent, goal: number): boolean {
  const g = rt.grid;
  const path = findPath(g, Math.floor(a.x), Math.floor(a.y), goal % g.w, Math.floor(goal / g.w));
  if (!path) return false;
  a.path = path.reverse();
  a.goal = goal;
  return true;
}

/** Where someone stands to work a checkout or station: behind it if possible, otherwise beside it. */
export function operatorTile(obj: PlacedObject): number | null {
  const g = rt.grid;
  const front = frontTiles(obj)[0];
  const back = backTile(obj);
  const options = [back, { x: obj.x - 1, y: obj.y }, { x: obj.x + 1, y: obj.y }, { x: obj.x, y: obj.y - 1 }, { x: obj.x, y: obj.y + 1 }];
  const spot = options.find((t) => walkable(g, t.x, t.y) && !(t.x === front.x && t.y === front.y));
  return spot ? tileOf(spot.x, spot.y) : null;
}

/** Customers currently inside a shop (they will need serving). */
const customersIn = (shopId: number): number => rt.customers.reduce((n, c) => n + (c.shopId === shopId && c.entered ? 1 : 0), 0);

/** A checkout nobody else is running: the one assigned to this employee if free, else any. */
function freeRegister(s: GameState, shop: ShopState, e: Employee): PlacedObject | undefined {
  const taken = new Set<number>();
  if (s.ownerAt?.shopId === shop.id) taken.add(s.ownerAt.objectId);
  for (const other of s.staff) {
    if (other.id === e.id || other.shopId !== shop.id) continue;
    const oa = rt.staff.get(other.id);
    if (oa && oa.task === 'serve' && oa.taskObj >= 0) taken.add(oa.taskObj);
  }
  const regs = registers(shop).filter((r) => !taken.has(r.id) && operatorTile(r) !== null);
  // Go where the queue is.
  regs.sort((a, b) => (rt.registers.get(regKey(shop.id, b.id))?.queue.length ?? 0) - (rt.registers.get(regKey(shop.id, a.id))?.queue.length ?? 0));
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

function createAgent(shop: ShopState): StaffAgent | null {
  const lot = session.city.lots[shop.lotId];
  const door = nearestDoor(shop, { x: lot.x + lot.w / 2, y: lot.y + lot.h / 2 });
  const start = door ?? standingTiles(shop)[0];
  if (start === undefined) return null;
  return {
    id: 0,
    x: (start % rt.grid.w) + 0.5,
    y: Math.floor(start / rt.grid.w) + 0.5,
    path: [],
    goal: start,
    state: 'idle',
    timer: rand.range(0, 0.5),
    stationObj: -1,
    taskObj: -1,
    taskSlot: -1,
    activity: 'Starting their shift',
    task: '',
    breakAfter: 0,
  };
}

function removeAgent(id: number): void {
  if (rt.staff.delete(id)) bus.emit('staff:removed', id);
}

/** Walk to a tile and then work there for `minutes`; or start at once if already standing on it. */
function goWork(a: StaffAgent, tile: number, task: string, activity: string, minutes: number): boolean {
  if (tile !== here(a) && !setPath(a, tile)) return false;
  a.task = task;
  a.activity = activity;
  a.timer = minutes;
  a.state = tile === here(a) ? 'working' : 'toTask';
  return true;
}

// ---------- Tasks ----------

/**
 * Try to start one task. Returns true if the employee is now doing it.
 * `urgent` is false when nothing has work waiting and they are just taking up their post.
 */
function startTask(s: GameState, shop: ShopState, e: Employee, a: StaffAgent, task: string, urgent: boolean): boolean {
  const g = rt.grid;
  switch (task) {
    case 'serve': {
      // Worth doing while anyone is in the shop; otherwise only as a default post.
      if (urgent && customersIn(shop.id) === 0) return false;
      const reg = freeRegister(s, shop, e);
      const tile = reg ? operatorTile(reg) : null;
      if (!reg || tile === null) return false;
      a.taskObj = reg.id;
      return goWork(a, tile, 'serve', 'Working the checkout', RECHECK_MINUTES);
    }
    case 'restock': {
      // Refill whichever shelf section is emptiest and has stock waiting in the back.
      let best: { obj: PlacedObject; slot: number; fill: number } | null = null;
      for (const obj of shop.objects) {
        if (defOf(obj).kind !== 'shelf') continue;
        obj.slots?.forEach((sl, i) => {
          if (!sl.product || batchQty(shop.storage[sl.product]) <= 0) return;
          const fill = batchQty(sl.batches) / (defOf(obj).slotCapacity ?? 1);
          if (fill < 0.75 && (!best || fill < best.fill)) best = { obj, slot: i, fill };
        });
      }
      const job = best as { obj: PlacedObject; slot: number; fill: number } | null;
      if (!job) return false;
      const spot = frontTiles(job.obj).find((t) => walkable(g, t.x, t.y));
      if (!spot) return false;
      a.taskObj = job.obj.id;
      a.taskSlot = job.slot;
      return goWork(a, tileOf(spot.x, spot.y), 'restock', 'Restocking shelves', 0.9 / performance(e));
    }
    case 'clean': {
      if (urgent && shop.dirt < 12) return false;
      if (!urgent) return false;
      const tiles = standingTiles(shop);
      if (!tiles.length) return false;
      return goWork(a, rand.pick(tiles), 'clean', 'Cleaning', rand.range(1.5, 3));
    }
    case 'cook': {
      if (urgent && !(rt.kitchens.get(shop.id)?.length ?? 0)) return false;
      const taken = new Set([...rt.staff.values()].filter((x) => x.id !== a.id && x.task === 'cook').map((x) => x.taskObj));
      const station = shop.objects.find((o) => defOf(o).kind === 'cookstation' && !o.broken && !taken.has(o.id) && operatorTile(o) !== null);
      const tile = station ? operatorTile(station) : null;
      if (!station || tile === null) return false;
      a.taskObj = station.id;
      return goWork(a, tile, 'cook', 'Cooking', RECHECK_MINUTES);
    }
    case 'repair': {
      const broken = shop.objects.find((o) => o.broken);
      if (!broken) return false;
      const spot = objectTiles(broken).flatMap((t) => [[t.x + 1, t.y], [t.x - 1, t.y], [t.x, t.y + 1], [t.x, t.y - 1]]).find(([x, y]) => walkable(g, x, y));
      if (!spot) return false;
      a.taskObj = broken.id;
      return goWork(a, tileOf(spot[0], spot[1]), 'repair', `Repairing the ${defOf(broken).name.toLowerCase()}`, 8 / performance(e));
    }
    case 'guard': {
      if (urgent) return false;
      // Stand where the door can be watched.
      const tiles = standingTiles(shop);
      const door = nearestDoor(shop, a);
      if (!tiles.length || door === null) return false;
      const dx = door % g.w;
      const dy = Math.floor(door / g.w);
      const post = tiles.slice().sort((p, q) => Math.hypot((p % g.w) - dx, Math.floor(p / g.w) - dy) - Math.hypot((q % g.w) - dx, Math.floor(q / g.w) - dy))[Math.min(2, tiles.length - 1)];
      return goWork(a, post, 'guard', 'Watching the door', RECHECK_MINUTES);
    }
    case 'operate': {
      if (!shop.objects.some((o) => defOf(o).kind === 'producer')) return false;
      if (urgent && !shop.objects.some((o) => defOf(o).kind === 'producer' && o.recipe && !o.broken)) return false;
      const machine = shop.objects.find((o) => defOf(o).kind === 'producer' && operatorTile(o) !== null);
      const tile = machine ? operatorTile(machine) : null;
      if (tile === null || tile === undefined) return false;
      return goWork(a, tile, 'operate', 'Running the machines', RECHECK_MINUTES * 3);
    }
    case 'manage': {
      if (urgent) return false;
      const tiles = standingTiles(shop);
      const tile = tiles[(e.id * 7) % Math.max(1, tiles.length)];
      if (tile === undefined) return false;
      return goWork(a, tile, 'manage', 'Managing the shop', RECHECK_MINUTES * 5);
    }
  }
  return false;
}

/** Decide what an employee with nothing in hand does next. */
function plan(s: GameState, shop: ShopState, e: Employee, a: StaffAgent): void {
  a.taskObj = -1;
  a.taskSlot = -1;
  a.stationObj = -1;
  const tasks = prioritiesOf(shop, e.role);
  const now = s.time.minutes;

  // Tired staff take a break when there is no queue, on a seat if one is free.
  if (e.energy < BREAK_BELOW_ENERGY && now >= a.breakAfter && customersIn(shop.id) < 3) {
    const tiles = standingTiles(shop);
    if (tiles.length && goWork(a, rand.pick(tiles), 'break', 'On a break', BREAK_MINUTES * (hasTrait(e, 'wageMult') && traitSum(e, 'speed') < 0 ? 1.5 : 1))) {
      a.breakAfter = now + BREAK_COOLDOWN;
      return;
    }
  }

  // Lazy staff sometimes look the other way when only low-priority work is waiting.
  const slack = traitSum(e, 'speed') < 0 && rand.chance(0.35);
  for (let i = 0; i < tasks.length; i++) {
    if (slack && i > 0) break;
    if (startTask(s, shop, e, a, tasks[i], true)) return;
  }

  // Nothing needs doing. Chat with an idle colleague, or go back to the usual post.
  const colleague = s.staff.find((o) => o.id !== e.id && o.shopId === shop.id && rt.staff.get(o.id)?.task === 'idle');
  const diligent = traitSum(e, 'speed') > 0;
  if (colleague && !diligent && rand.chance(0.5)) {
    const other = rt.staff.get(colleague.id)!;
    const spot = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [Math.floor(other.x) + dx, Math.floor(other.y) + dy]).find(([x, y]) => walkable(rt.grid, x, y));
    if (spot && goWork(a, tileOf(spot[0], spot[1]), 'chat', `Chatting with ${colleague.name.split(' ')[0]}`, rand.range(2, 5))) {
      other.task = 'chat';
      other.activity = `Chatting with ${e.name.split(' ')[0]}`;
      other.state = 'working';
      other.timer = a.timer + 1;
      return;
    }
  }
  if (startTask(s, shop, e, a, tasks[0], false)) return;
  a.task = 'idle';
  a.activity = 'Nothing to do';
  a.state = 'working';
  a.timer = RECHECK_MINUTES;
}

/** Arrived where the task is. */
function arrive(a: StaffAgent): void {
  if (a.state === 'leaving') return removeAgent(a.id);
  a.state = 'working';
  if (a.task === 'serve') a.stationObj = a.taskObj;
}

/** The current stint of work is over: apply its result and look for the next thing. */
function finishWork(s: GameState, shop: ShopState, e: Employee, a: StaffAgent): void {
  const obj = shop.objects.find((o) => o.id === a.taskObj);
  if (a.task === 'restock' && obj?.slots) fillSlot(shop, obj, a.taskSlot, Math.round(CARRY_UNITS * traitSum(e, 'carry')));
  else if (a.task === 'repair' && obj?.broken) {
    obj.broken = false;
    bus.emit('shop:changed', shop.id);
  } else if (a.task === 'break') e.energy = clamp(e.energy + 18, 0, 100);
  else if (a.task === 'chat') e.morale = clamp(e.morale + 1.5, 0, 100);

  // Someone at a post stays put unless something more important has come up.
  if (a.task === 'serve' || a.task === 'cook' || a.task === 'guard' || a.task === 'manage' || a.task === 'operate') {
    const tasks = prioritiesOf(shop, e.role);
    const mine = tasks.indexOf(a.task);
    const needed = a.task === 'serve' ? customersIn(shop.id) > 0 : a.task === 'cook' ? (rt.kitchens.get(shop.id)?.length ?? 0) > 0 : false;
    const tired = e.energy < BREAK_BELOW_ENERGY && s.time.minutes >= a.breakAfter && customersIn(shop.id) < 3;
    // Higher-priority work always pulls them away; lower-priority work only when their own post is quiet.
    const before = tasks.slice(0, Math.max(0, mine));
    const after = needed ? [] : tasks.slice(mine + 1);
    const station = a.stationObj;
    const taskObj = a.taskObj;
    if (!tired) {
      const probe = { ...a };
      const pulled = [...before, ...after].some((t) => startTask(s, shop, e, probe as StaffAgent, t, true));
      if (!pulled) {
        a.timer = RECHECK_MINUTES;
        a.stationObj = station;
        a.taskObj = taskObj;
        return;
      }
    }
  }
  a.state = 'idle';
  a.timer = 0;
}

/** Move along the planned path by `dist` tiles. */
function walk(a: StaffAgent, dist: number): void {
  const g = rt.grid;
  while (dist > 0 && a.path.length) {
    const n = a.path[a.path.length - 1];
    if (g.cost[n] === 0) {
      if (!setPath(a, a.goal)) {
        a.path = [];
        if (a.state !== 'leaving') {
          a.state = 'idle';
          a.timer = 0.5;
        }
      }
      return;
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
}

const CHASE_RANGE = 26;
const CATCH_DISTANCE = 1.1;

/** Run after a fleeing shoplifter. Returns true while the chase is on. */
function chase(shop: ShopState, e: Employee, a: StaffAgent, dt: number): boolean {
  const near = (c: { x: number; y: number }): boolean => Math.hypot(c.x - a.x, c.y - a.y) < CHASE_RANGE;
  let thief = a.task === 'chase' ? rt.byId.get(a.taskObj) : undefined;
  if (!thief?.fleeing || !near(thief)) thief = rt.customers.find((c) => c.fleeing && c.fleeFrom === shop.id && near(c));
  if (!thief) {
    if (a.task === 'chase') {
      // Lost them, or someone else got there first: back to work.
      a.task = '';
      a.path = [];
      a.state = 'idle';
      a.timer = 0;
    }
    return false;
  }
  if (a.task !== 'chase') {
    a.task = 'chase';
    a.activity = 'Chasing a shoplifter';
    a.taskObj = thief.id;
    a.stationObj = -1;
    a.state = 'toTask';
    a.timer = 0;
    a.path = [];
  }
  a.taskObj = thief.id;
  if (Math.hypot(thief.x - a.x, thief.y - a.y) < CATCH_DISTANCE) {
    bus.emit('thief:caught', { customerId: thief.id, by: e.id });
    return true;
  }
  // The thief keeps moving, so keep correcting course.
  a.timer -= dt;
  if (a.timer <= 0 || !a.path.length) {
    a.timer = 0.2;
    setPath(a, tileOf(Math.floor(thief.x), Math.floor(thief.y)));
  }
  walk(a, STAFF_SPEED * 1.4 * performance(e) * dt);
  return true;
}

/** Advance all staff by `dt` game minutes and make sure the right people are on site. */
export function updateStaff(dt: number): void {
  if (dt <= 0) return;
  const s = session.state;

  for (const e of s.staff) {
    const shop = e.shopId !== null ? shopById(s, e.shopId) : undefined;
    let a = rt.staff.get(e.id);
    const due = !!shop && onDuty(s, e);
    if (!shop || (!due && !a)) {
      if (a) removeAgent(e.id);
      continue;
    }
    if (due && !a) {
      const fresh = createAgent(shop);
      if (!fresh) continue;
      fresh.id = e.id;
      rt.staff.set(e.id, fresh);
      a = fresh;
    }
    if (!a) continue;

    if (!due && a.state !== 'leaving') {
      // Shift over: head for the door.
      const door = nearestDoor(shop, a);
      a.stationObj = -1;
      a.task = '';
      a.activity = 'Going home';
      if (door === null || !setPath(a, door)) {
        removeAgent(e.id);
        continue;
      }
      a.state = 'leaving';
    }

    // A shoplifter running for it: whoever guards drops everything and gives chase.
    if (a.state !== 'leaving' && (a.task === 'chase' || prioritiesOf(shop, e.role).includes('guard'))) {
      if (chase(shop, e, a, dt)) continue;
    }

    // Cleaning happens wherever they are while on that task; dedicated cleaners are better at it.
    if (a.task === 'clean' && a.state !== 'leaving') shop.dirt = clamp(shop.dirt - dt * 0.2 * performance(e) * (e.role === 'cleaner' ? 1 : 0.6), 0, 100);

    if (a.state === 'idle') {
      a.timer -= dt;
      if (a.timer <= 0) plan(s, shop, e, a);
      continue;
    }
    if (a.state === 'working') {
      // If their checkout or station was sold, or the owner took it over, look again.
      if ((a.task === 'serve' || a.task === 'cook') && (!shop.objects.some((o) => o.id === a.taskObj) || (a.task === 'serve' && s.ownerAt?.shopId === shop.id && s.ownerAt.objectId === a.taskObj))) {
        a.state = 'idle';
        a.timer = 0;
        continue;
      }
      a.timer -= dt;
      if (a.timer <= 0) finishWork(s, shop, e, a);
      continue;
    }

    walk(a, STAFF_SPEED * dt);
    if (!a.path.length && (a.state === 'toTask' || a.state === 'leaving' || a.state === 'arriving')) arrive(a);
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
    if (e.shopId !== shopId) continue;
    const a = rt.staff.get(e.id);
    if (a && a.state === 'working' && a.task === 'serve' && a.stationObj === objectId) return e;
  }
  return undefined;
}

/**
 * Whether customers can count on someone coming to the till: the owner is on it, it is
 * self-service, or someone on shift has serving among their tasks (even if they have
 * stepped away to restock; they come back when a queue forms).
 */
export function registerCovered(s: GameState, shop: ShopState): boolean {
  if ((s.upgrades[shop.id]?.selfCheckout ?? 0) > 0) return true;
  if (s.ownerAt?.shopId === shop.id) return true;
  return s.staff.some((e) => e.shopId === shop.id && onDuty(s, e) && prioritiesOf(shop, e.role).includes('serve'));
}

/** Staff on shift who cook, as work-rate multipliers; used by the kitchen. */
export const cooksAt = (s: GameState, shop: ShopState): Employee[] => s.staff.filter((e) => e.shopId === shop.id && rt.staff.get(e.id)?.state === 'working' && rt.staff.get(e.id)?.task === 'cook');

/** True if this business has any use for a task (so the board only lists relevant ones). */
export const taskApplies = (shop: ShopState, task: string): boolean => {
  const type = SHOP_TYPES[shop.type];
  if (task === 'cook') return type.flow === 'counter';
  if (task === 'operate') return type.flow === 'factory';
  if (task === 'serve') return type.furniture.some((f) => f === 'register' || f === 'counter');
  return true;
};
