import { bus } from '../../core/events';
import { recordSale } from '../../entities/Shop';
import { clamp, money } from '../../core/format';
import { rand } from '../../core/rng';
import { session, shopById, type GameState } from '../../core/state';
import { CITY_CONFIG, POPULATION, PRODUCTS, SHOP_TYPES } from '../../data';
import { batchQty, defOf, footprint, type PlacedObject, type ShopState } from '../../entities/Shop';
import { T } from '../city/generate';
import { earn, spend } from '../economy/finance';
import { consumeIngredients, hasIngredients, inStorage, takeFromSlot, takeFromStorage } from '../economy/stock';
import { breakMult } from '../shop/modifiers';
import { fairPrice } from '../shop/pricing';
import { isOpenNow } from '../shop/status';
import { machinesOf, restockMachine } from '../shop/vending';
import { onDuty } from '../staff/staff';
import { activity } from './customers';
import type { Grid } from './grid';
import { findPath } from './pathfind';
import { regKey, rt, type Car } from './runtime';

const TRAFFIC = POPULATION.traffic;
export const VAN_LOOK = 99;
export const BUS_LOOK = 100;

// ---------- Traffic lights ----------

/** Game minutes for a full cycle: north-south green, all red, east-west green, all red. */
const LIGHT_CYCLE = 3;
const roadCols = new Set<number>();
const roadRows = new Set<number>();
const street = CITY_CONFIG.roadW + CITY_CONFIG.sidewalkW * 2;

/** Which block corner a road tile's intersection belongs to, or -1 if it is not in one. */
const crossingIndex = (x: number, y: number): number => (roadCols.has(x) && roadRows.has(y) ? Math.floor(x / (CITY_CONFIG.blockW + street)) + Math.floor(y / (CITY_CONFIG.blockH + street)) * 64 : -1);

/** Which direction of travel has green at an intersection right now. */
export function greenAxis(index: number, minutes: number): 'ns' | 'ew' | 'none' {
  // Offset each junction so the whole city does not change at once.
  const t = (minutes + (index * 37) % 7 * 0.4) % LIGHT_CYCLE;
  if (t < LIGHT_CYCLE * 0.42) return 'ns';
  if (t < LIGHT_CYCLE * 0.5) return 'none';
  if (t < LIGHT_CYCLE * 0.92) return 'ew';
  return 'none';
}

/** Every signalled junction: where to draw its signal, and its index for `greenAxis`. */
export function trafficSignals(): { x: number; y: number; index: number }[] {
  const out: { x: number; y: number; index: number }[] = [];
  for (let by = 0; by <= CITY_CONFIG.blocksY; by++) {
    for (let bx = 0; bx <= CITY_CONFIG.blocksX; bx++) {
      const x0 = bx * (CITY_CONFIG.blockW + street);
      const y0 = by * (CITY_CONFIG.blockH + street);
      // The signal stands on the pavement at the junction's north-east corner.
      out.push({ x: x0 + street - 1, y: y0, index: crossingIndex(x0 + CITY_CONFIG.sidewalkW, y0 + CITY_CONFIG.sidewalkW) });
    }
  }
  return out;
}

// ---------- Setup ----------

export function initVehicles(): void {
  const { city } = session;
  const grid: Grid = { w: city.w, h: city.h, cost: new Uint8Array(city.w * city.h) };
  rt.roadEdges = [];
  roadCols.clear();
  roadRows.clear();
  for (let b = 0; b <= CITY_CONFIG.blocksX; b++) for (let i = 0; i < CITY_CONFIG.roadW; i++) roadCols.add(b * (CITY_CONFIG.blockW + street) + CITY_CONFIG.sidewalkW + i);
  for (let b = 0; b <= CITY_CONFIG.blocksY; b++) for (let i = 0; i < CITY_CONFIG.roadW; i++) roadRows.add(b * (CITY_CONFIG.blockH + street) + CITY_CONFIG.sidewalkW + i);
  for (let i = 0; i < city.tiles.length; i++) {
    const t = city.tiles[i];
    if (t !== T.Road && t !== T.Crosswalk) continue;
    grid.cost[i] = 10;
    const x = i % city.w;
    const y = Math.floor(i / city.w);
    if (t === T.Road && (x === 0 || y === 0 || x === city.w - 1)) rt.roadEdges.push(i);
  }
  rt.roadGrid = grid;
  rt.cars = [];
  syncVending();
  const start = Math.round(TRAFFIC.cars * activity());
  for (let i = 0; i < start; i++) {
    const car = spawnCar();
    if (car && car.path.length > 6) {
      car.path.length -= rand.int(0, car.path.length - 3);
      const tile = car.path[car.path.length - 1];
      car.x = (tile % grid.w) + 0.5;
      car.y = Math.floor(tile / grid.w) + 0.5;
    }
  }
}

/** Rebuild the lookup of vending machines by tile. Call when any shop's furniture changes. */
export function syncVending(): void {
  rt.vendingAt.clear();
  for (const shop of session.state.shops) for (const o of machinesOf(shop)) rt.vendingAt.set(o.y * session.city.w + o.x, { shopId: shop.id, objId: o.id });
}

// ---------- Helpers ----------

/** The road tile closest to a map position. */
function nearestRoad(x: number, y: number): number {
  const g = rt.roadGrid;
  for (let r = 0; r < 12; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = Math.round(x) + dx;
        const ty = Math.round(y) + dy;
        if (tx >= 0 && ty >= 0 && tx < g.w && ty < g.h && g.cost[ty * g.w + tx]) return ty * g.w + tx;
      }
    }
  }
  return rt.roadEdges[0];
}

function route(car: Car, goal: number): boolean {
  const g = rt.roadGrid;
  const from = nearestRoad(car.x - 0.5, car.y - 0.5);
  const path = findPath(g, from % g.w, Math.floor(from / g.w), goal % g.w, Math.floor(goal / g.w));
  if (!path) return false;
  car.path = path.reverse();
  return true;
}

function spawnCar(van?: Car['van']): Car | null {
  if (!rt.roadEdges.length) return null;
  const g = rt.roadGrid;
  const from = rand.pick(rt.roadEdges);
  const car: Car = {
    id: rt.nextCarId++,
    x: (from % g.w) + 0.5,
    y: Math.floor(from / g.w) + 0.5,
    heading: 0,
    look: van ? VAN_LOOK : rand.chance(0.06) ? BUS_LOOK : rand.int(0, 5),
    path: [],
    state: 'drive',
    shopId: -1,
    objId: -1,
    timer: 0,
    todo: [],
    seen: [],
    roadTile: from,
    van,
  };
  if (!van && !route(car, rand.pick(rt.roadEdges))) return null;
  // Some drivers pull over part-way for an errand, then carry on.
  if (!van && car.look !== BUS_LOOK && car.path.length > 30 && rand.chance(0.2)) car.parkAt = rand.int(8, car.path.length - 12);
  rt.cars.push(car);
  return car;
}

function removeCar(car: Car): void {
  release(car);
  const i = rt.cars.indexOf(car);
  if (i >= 0) rt.cars.splice(i, 1);
  bus.emit('car:removed', car.id);
}

function release(car: Car): void {
  if (car.objId < 0) return;
  const users = rt.stations.get(regKey(car.shopId, car.objId));
  const i = users ? users.indexOf(-car.id) : -1;
  if (i >= 0) users!.splice(i, 1);
  car.objId = -1;
}

const centre = (o: PlacedObject): { x: number; y: number } => {
  const { w, h } = footprint(o.def, o.rot);
  return { x: o.x + w / 2, y: o.y + h / 2 };
};

function bubble(car: Car, text: string, kind: 'good' | 'bad' | 'neutral'): void {
  bus.emit('world:bubble', { x: car.x, y: car.y - 0.6, text, kind });
}

function charge(s: GameState, shop: ShopState, amount: number, category: 'sales' | 'services', car: Car): void {
  earn(s, amount, category);
  shop.today.revenue += amount;
  recordSale(shop, category === 'sales' ? 'fuel' : 'svc_car', amount);
  bus.emit('sale', { shopId: shop.id, amount, x: car.x - 0.5, y: car.y - 0.5 });
}

/** A free, working station of a given service in a shop, reserved for this car. */
function claim(s: GameState, shop: ShopState, service: string, car: Car): PlacedObject | null {
  for (const o of shop.objects) {
    const d = defOf(o);
    if (!d.vehicle || d.service !== service || o.broken) continue;
    if (d.needsRole && !s.staff.some((e) => e.shopId === shop.id && e.role === d.needsRole && onDuty(s, e))) continue;
    const key = regKey(shop.id, o.id);
    let users = rt.stations.get(key);
    if (!users) rt.stations.set(key, (users = []));
    if (users.length >= (d.capacity ?? 1)) continue;
    // Cars are stored as negative ids so they never collide with pedestrians.
    users.push(-car.id);
    return o;
  }
  return null;
}

// ---------- Gas station visits ----------

/** A passing car decides whether to pull in. */
function considerStations(s: GameState, car: Car): void {
  for (const shop of s.shops) {
    const type = SHOP_TYPES[shop.type];
    if (!type.carDemand || !isOpenNow(s, shop)) continue;
    const lot = session.city.lots[shop.lotId];
    const dx = Math.max(lot.x - car.x, 0, car.x - (lot.x + lot.w));
    const dy = Math.max(lot.y - car.y, 0, car.y - (lot.y + lot.h));
    if (Math.max(dx, dy) > 3 || car.seen.includes(shop.id)) continue;
    car.seen.push(shop.id);
    if (!rand.chance(TRAFFIC.fuelStopChance * type.carDemand * (0.4 + shop.reputation / 83))) continue;
    const pump = claim(s, shop, 'fuel', car);
    if (!pump) continue;
    car.shopId = shop.id;
    car.objId = pump.id;
    car.todo = ['fuel'];
    car.roadTile = nearestRoad(car.x - 0.5, car.y - 0.5);
    car.state = 'toStation';
    shop.today.customers++;
    return;
  }
}

/** Start whatever the car pulled up for. Returns minutes of service, or 0 if it could not be done. */
function beginService(s: GameState, shop: ShopState, obj: PlacedObject, car: Car): number {
  const service = car.todo[0];
  const d = defOf(obj);
  const mood = (delta: number): void => {
    shop.reputation = clamp(shop.reputation + delta, 0, 100);
  };

  if (service === 'fuel') {
    const want = rand.int(2, 6);
    const price = shop.prices.fuel;
    const fair = fairPrice(s, shop, 'fuel');
    if (price > fair * (1.06 + rand.range(0, 0.1))) {
      bubble(car, 'Fuel is too expensive here!', 'bad');
      mood(-0.5);
      shop.today.walkouts++;
      return 0;
    }
    const got = takeFromStorage(shop, 'fuel', want);
    if (!got) {
      bubble(car, 'The pumps are dry!', 'bad');
      mood(-0.7);
      shop.today.walkouts++;
      return 0;
    }
    let total = got * price;
    shop.today.unitsSold += got;
    // Some drivers grab something from the shop while they are here.
    if (rand.chance(TRAFFIC.martChance)) {
      const stocked = shop.objects.flatMap((o) => (defOf(o).kind === 'shelf' ? (o.slots ?? []).filter((sl) => sl.product && batchQty(sl.batches) > 0) : []));
      if (stocked.length) {
        const slot = rand.pick(stocked);
        const n = takeFromSlot(shop, slot, rand.int(1, 2));
        total += n * shop.prices[slot.product!];
        shop.today.unitsSold += n;
      }
    }
    charge(s, shop, Math.round(total * 100) / 100, 'sales', car);
    shop.today.served++;
    mood(price < fair * 0.97 ? 0.3 : 0.12);
    if (price < fair * 0.95) bubble(car, 'Cheap fuel!', 'good');
    return 3;
  }

  const product = PRODUCTS[service];
  const price = shop.prices[service];
  if (price > fairPrice(s, shop, service) * (1.15 + rand.range(0, 0.25)) || !hasIngredients(shop, product.recipe)) {
    if (service === 'svc_repair') {
      bubble(car, hasIngredients(shop, product.recipe) ? 'That quote is outrageous!' : 'No parts? Useless.', 'bad');
      mood(-0.5);
    }
    return 0;
  }
  consumeIngredients(shop, product.recipe);
  charge(s, shop, price, 'services', car);
  if (product.wholesale > 0) {
    spend(s, product.wholesale, 'utilities');
    shop.today.costs += product.wholesale;
  }
  if (service === 'svc_repair') {
    shop.today.customers++;
    shop.today.served++;
    bubble(car, `Repair booked: ${money(price)}`, 'neutral');
  }
  mood(0.15);
  return d.duration ?? product.duration ?? 5;
}

function finishService(s: GameState, shop: ShopState, obj: PlacedObject, car: Car): void {
  const d = defOf(obj);
  if (d.breakChance && rand.chance(d.breakChance * breakMult(s, shop))) {
    obj.broken = true;
    bus.emit('toast', { text: `${shop.name}: the ${d.name.toLowerCase()} has broken down.`, kind: 'warn' });
    bus.emit('shop:changed', shop.id);
  }
  const done = car.todo.shift();
  release(car);
  // After filling up, some drivers go through the car wash.
  if (done === 'fuel' && rand.chance(TRAFFIC.washChance)) {
    const wash = claim(s, shop, 'svc_carwash', car);
    if (wash) {
      car.objId = wash.id;
      car.todo = ['svc_carwash'];
      car.state = 'toStation';
      return;
    }
  }
  car.state = 'toRoad';
}

/** Cars that come specifically for repairs, when a bay is staffed and has parts. */
function spawnRepairJobs(s: GameState, dt: number): void {
  for (const shop of s.shops) {
    if (!isOpenNow(s, shop) || !shop.objects.some((o) => defOf(o).service === 'svc_repair')) continue;
    if (!rand.chance((TRAFFIC.repairPerHour / 60) * dt * activity() * (0.5 + shop.reputation / 100))) continue;
    const car = spawnCar();
    if (!car) continue;
    const bay = claim(s, shop, 'svc_repair', car);
    if (!bay) continue;
    const c = centre(bay);
    car.shopId = shop.id;
    car.objId = bay.id;
    car.todo = ['svc_repair'];
    car.roadTile = nearestRoad(c.x, c.y);
    if (!route(car, car.roadTile)) removeCar(car);
  }
}

// ---------- Vending route ----------

const needsVisit = (shop: ShopState, o: PlacedObject): boolean =>
  (o.cash ?? 0) >= 15 || (o.slots ?? []).some((sl) => sl.product && batchQty(sl.batches) < (defOf(o).slotCapacity ?? 1) * 0.6 && inStorage(shop, sl.product) > 0);

/** Send each depot's driver out when enough machines need attention. */
function dispatchVans(s: GameState): void {
  for (const shop of s.shops) {
    if (SHOP_TYPES[shop.type].flow !== 'depot') continue;
    const driver = s.staff.find((e) => e.shopId === shop.id && e.role === 'driver' && onDuty(s, e) && !rt.cars.some((c) => c.van?.driverId === e.id));
    if (!driver) continue;
    const due = machinesOf(shop).filter((o) => needsVisit(shop, o));
    if (!due.length) continue;
    const lot = session.city.lots[shop.lotId];
    const car = spawnCar({ shopId: shop.id, stops: [], driverId: driver.id });
    if (!car) continue;
    const home = nearestRoad(lot.x + lot.w / 2, lot.front === 'n' ? lot.y - 2 : lot.y + lot.h + 1);
    car.x = (home % rt.roadGrid.w) + 0.5;
    car.y = Math.floor(home / rt.roadGrid.w) + 0.5;
    car.roadTile = home;
    // Nearest-neighbour order keeps the round short.
    let from = { x: car.x, y: car.y };
    const left = [...due];
    while (left.length) {
      left.sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y));
      const next = left.shift()!;
      car.van!.stops.push(next.id);
      from = next;
    }
    nextVanStop(s, car);
  }
}

function nextVanStop(s: GameState, car: Car): void {
  const shop = shopById(s, car.van!.shopId);
  const obj = shop?.objects.find((o) => o.id === car.van!.stops[0]);
  if (!shop || (car.van!.stops.length && !obj)) {
    car.van!.stops.shift();
    return car.van!.stops.length ? nextVanStop(s, car) : void route(car, car.roadTile);
  }
  if (!obj) {
    // Round finished: back to the depot.
    if (!route(car, car.roadTile) || !car.path.length) removeCar(car);
    return;
  }
  if (!route(car, nearestRoad(obj.x, obj.y))) car.van!.stops.shift();
}

// ---------- Per-frame update ----------

let dispatchTimer = 0;
const occupied = new Map<number, Car>();

export function updateVehicles(dt: number): void {
  if (dt <= 0) return;
  const s = session.state;
  const g = rt.roadGrid;

  const target = Math.round(TRAFFIC.cars * activity());
  if (rt.cars.filter((c) => !c.van).length < target && rand.chance(dt * 0.6)) spawnCar();
  spawnRepairJobs(s, dt);
  dispatchTimer -= dt;
  if (dispatchTimer <= 0) {
    dispatchTimer = 10;
    dispatchVans(s);
  }

  // Which car holds each road tile, so the one behind waits. Parked cars are off the lane.
  occupied.clear();
  for (const c of rt.cars) if (c.state === 'drive') occupied.set(Math.floor(c.y) * g.w + Math.floor(c.x), c);

  for (let i = rt.cars.length - 1; i >= 0; i--) {
    const car = rt.cars[i];
    const shop = car.shopId >= 0 ? shopById(s, car.shopId) : undefined;
    const obj = shop?.objects.find((o) => o.id === car.objId);

    if (car.state === 'parked') {
      car.timer -= dt;
      if (car.timer <= 0) car.state = 'drive';
      continue;
    }

    if (car.state === 'service') {
      car.timer -= dt;
      if (car.timer > 0) continue;
      if (car.van) {
        car.van.stops.shift();
        car.state = 'drive';
        nextVanStop(s, car);
      } else if (shop && obj) finishService(s, shop, obj, car);
      else car.state = 'toRoad';
      continue;
    }

    if (car.state === 'toStation' || car.state === 'toRoad') {
      // Off the road network: drive straight to the pump or bay, or back to the kerb.
      if (car.state === 'toStation' && (!shop || !obj)) {
        release(car);
        car.state = 'toRoad';
        continue;
      }
      const dest = car.state === 'toStation' ? centre(obj!) : { x: (car.roadTile % g.w) + 0.5, y: Math.floor(car.roadTile / g.w) + 0.5 };
      // Pull up beside single-tile pumps rather than on top of them.
      if (car.state === 'toStation' && footprint(obj!.def, obj!.rot).w === 1) dest.x += 1;
      const d = Math.hypot(dest.x - car.x, dest.y - car.y);
      const step = TRAFFIC.speed * 0.5 * dt;
      if (d > step) {
        car.heading = Math.atan2(dest.y - car.y, dest.x - car.x);
        car.x += ((dest.x - car.x) / d) * step;
        car.y += ((dest.y - car.y) / d) * step;
        continue;
      }
      car.x = dest.x;
      car.y = dest.y;
      if (car.state === 'toStation') {
        const minutes = beginService(s, shop!, obj!, car);
        if (minutes > 0) {
          car.state = 'service';
          car.timer = minutes;
        } else {
          release(car);
          car.state = 'toRoad';
        }
      } else {
        car.state = 'drive';
        car.shopId = -1;
        if (!route(car, rand.pick(rt.roadEdges))) removeCar(car);
      }
      continue;
    }

    // On the road.
    let dist = TRAFFIC.speed * (car.look === BUS_LOOK ? 0.75 : 1) * dt;
    car.waiting = false;
    while (dist > 0 && car.path.length) {
      const n = car.path[car.path.length - 1];
      const tx = (n % g.w) + 0.5;
      const ty = Math.floor(n / g.w) + 0.5;
      // Stop at a red light: only when about to enter a junction, never once inside it.
      const next = crossingIndex(n % g.w, Math.floor(n / g.w));
      if (next >= 0 && crossingIndex(Math.floor(car.x), Math.floor(car.y)) < 0) {
        const axis = Math.abs(tx - car.x) > Math.abs(ty - car.y) ? 'ew' : 'ns';
        if (greenAxis(next, s.time.minutes) !== axis) {
          car.waiting = true;
          break;
        }
      }
      // Keep a gap behind whoever is ahead in the same lane.
      // Only cars going the same way count: oncoming traffic uses the other lane.
      const ahead = occupied.get(n);
      if (ahead && ahead !== car && Math.cos(ahead.heading - car.heading) > 0.5) {
        car.waiting = true;
        break;
      }
      const d = Math.hypot(tx - car.x, ty - car.y);
      if (d > 0.001) car.heading = Math.atan2(ty - car.y, tx - car.x);
      if (d <= dist) {
        car.x = tx;
        car.y = ty;
        car.path.pop();
        dist -= d;
        if (car.parkAt !== undefined && car.path.length <= car.parkAt && crossingIndex(n % g.w, Math.floor(n / g.w)) < 0) {
          car.parkAt = undefined;
          car.state = 'parked';
          car.timer = rand.range(8, 40);
          break;
        }
        if (!car.van && car.shopId < 0) {
          considerStations(s, car);
          if (car.state !== 'drive') break;
        }
      } else {
        car.x += ((tx - car.x) / d) * dist;
        car.y += ((ty - car.y) / d) * dist;
        dist = 0;
      }
    }
    if (car.path.length || car.state !== 'drive') continue;

    if (car.van) {
      const depot = shopById(s, car.van.shopId);
      const stop = depot?.objects.find((o) => o.id === car.van!.stops[0]);
      if (depot && stop) {
        restockMachine(s, depot, stop);
        car.state = 'service';
        car.timer = 2;
      } else removeCar(car);
    } else if (car.shopId >= 0 && car.todo.length) {
      // A repair customer has reached the kerb outside the garage.
      car.state = 'toStation';
    } else removeCar(car);
  }
}
