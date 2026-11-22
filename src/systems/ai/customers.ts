import { bus } from '../../core/events';
import { clamp } from '../../core/format';
import { rand } from '../../core/rng';
import { session, shopById } from '../../core/state';
import { NEIGHBORHOODS, POPULATION, PRODUCTS, SHOP_TYPES } from '../../data';
import { cartUnits, type Customer, type ThoughtKind } from '../../entities/Customer';
import { batchQty, decorScore, defOf, DIRS, doors, frontTiles, registers, type PlacedObject, type ShopState } from '../../entities/Shop';
import { idx, T } from '../city/generate';
import { earn } from '../economy/finance';
import { marketPrice } from '../economy/market';
import { addToStorage, takeFromSlot } from '../economy/stock';
import { isOpenNow, operatorSpeed } from '../shop/status';
import { dayOf, hourFloat, isWeekend } from '../time/clock';
import { buildGrid, rebuildLot, walkable } from './grid';
import { findPath } from './pathfind';
import { regKey, rt, type RegisterRuntime } from './runtime';
import { cashierAt, staffLayoutChanged } from '../staff/agents';
import { skill } from '../staff/staff';

const MAX_QUEUE_SLOTS = 8;
const LOOKS = 24;

// ---------- Setup ----------

export function initAi(): void {
  const { city } = session;
  rt.grid = buildGrid(city);
  rt.customers = [];
  rt.byId = new Map();
  rt.registers = new Map();
  rt.staff = new Map();
  rt.spawnDebt = 0;
  rt.spawnPoints = [];

  const add = (x: number, y: number, weightMult = 1): void => {
    if (!walkable(rt.grid, x, y)) return;
    const n = NEIGHBORHOODS[city.districtIds[city.districtAt[idx(city, x, y)]]];
    rt.spawnPoints.push({ tile: idx(city, x, y), weight: n.footTraffic * weightMult, wealth: n.wealth });
  };
  // People come out of every non-player building...
  for (const lot of city.lots) {
    if (lot.rentable) continue;
    add(lot.x + Math.floor(lot.w / 2), lot.front === 'n' ? lot.y - 1 : lot.y + lot.h, Math.sqrt(lot.w * lot.h) / 7);
  }
  // ...arrive from out of town along the map edge...
  for (let y = 0; y < city.h; y += 3) {
    if (city.tiles[idx(city, 0, y)] === T.Sidewalk) add(0, y, 0.6);
    if (city.tiles[idx(city, city.w - 1, y)] === T.Sidewalk) add(city.w - 1, y, 0.6);
  }
  for (let x = 0; x < city.w; x += 3) if (city.tiles[idx(city, x, 0)] === T.Sidewalk) add(x, 0, 0.6);
  // ...and hang around parks and the beach.
  for (let i = 0; i < city.tiles.length; i += 7) {
    if (city.tiles[i] === T.Path || (city.tiles[i] === T.Sand && i % 3 === 0)) add(i % city.w, Math.floor(i / city.w), 0.25);
  }
  rt.spawnWeightTotal = rt.spawnPoints.reduce((a, p) => a + p.weight, 0);

  for (const shop of session.state.shops) syncRegisters(shop);

  // Start with the streets already populated, people spread along their routes.
  const target = targetPopulation();
  for (let i = 0; i < target; i++) {
    const c = spawn();
    if (c && c.path.length > 4) {
      const skip = rand.int(0, c.path.length - 2);
      c.path.length -= skip;
      const tile = c.path[c.path.length - 1];
      c.x = (tile % rt.grid.w) + 0.5;
      c.y = Math.floor(tile / rt.grid.w) + 0.5;
    }
  }
}

/** Call after any change to a shop's walls, floor or furniture (or its removal). */
export function onShopLayoutChanged(shopId: number, lotId: number): void {
  const { city, state } = session;
  const lot = city.lots[lotId];
  rebuildLot(rt.grid, city, lot);
  const shop = shopById(state, shopId);
  if (shop) syncRegisters(shop);
  else for (const [key, reg] of rt.registers) if (reg.shopId === shopId) rt.registers.delete(key);
  staffLayoutChanged(shopId);

  for (const c of rt.customers) {
    const inside = c.x >= lot.x && c.y >= lot.y && c.x < lot.x + lot.w && c.y < lot.y + lot.h;
    if (c.shopId !== shopId && !inside) continue;
    if (!shop) {
      c.cart = [];
      resumeWalk(c);
    } else if (c.state === 'queue' || c.state === 'toQueue') {
      // Their line may have moved or vanished; start the checkout decision again.
      leaveQueue(c);
      c.wantIndex = c.wants.length;
      c.state = 'browse';
      c.timer = 0.1;
    } else if (c.state === 'toShelf' || c.state === 'pick') {
      c.state = 'browse';
      c.timer = 0.1;
      c.path = [];
    } else if (c.path.length && !setPath(c, c.goal)) {
      resumeWalk(c);
    }
  }
}

function syncRegisters(shop: ShopState): void {
  const live = new Set<string>();
  for (const obj of registers(shop)) {
    const key = regKey(shop.id, obj.id);
    live.add(key);
    const reg = rt.registers.get(key) ?? { shopId: shop.id, objectId: obj.id, queue: [], slots: [], progress: 0 };
    reg.slots = queueSlots(obj);
    rt.registers.set(key, reg);
  }
  for (const [key, reg] of rt.registers) if (reg.shopId === shop.id && !live.has(key)) rt.registers.delete(key);
}

/** A line of tiles leading away from the checkout, bending around obstacles. */
function queueSlots(obj: PlacedObject): number[] {
  const g = rt.grid;
  const front = frontTiles(obj)[0];
  if (!walkable(g, front.x, front.y)) return [];
  const slots = [front.y * g.w + front.x];
  let cur = front;
  const d = DIRS[obj.rot % 4];
  const order = [d, { x: -d.y, y: d.x }, { x: d.y, y: -d.x }];
  while (slots.length < MAX_QUEUE_SLOTS) {
    const next = order.map((o) => ({ x: cur.x + o.x, y: cur.y + o.y })).find((t) => walkable(g, t.x, t.y) && g.cost[t.y * g.w + t.x] === 10 && !slots.includes(t.y * g.w + t.x));
    if (!next) break;
    slots.push(next.y * g.w + next.x);
    cur = next;
  }
  return slots;
}

// ---------- Population ----------

/** Activity level for the current time, smoothly interpolated between hours. */
export function activity(): number {
  const t = session.state.time;
  const h = hourFloat(t);
  const a = POPULATION.hourly[Math.floor(h) % 24];
  const b = POPULATION.hourly[(Math.floor(h) + 1) % 24];
  return (a + (b - a) * (h % 1)) * (isWeekend(t) ? POPULATION.weekendMult : 1);
}

function targetPopulation(): number {
  return Math.min(POPULATION.maxPopulation, Math.round(POPULATION.basePopulation * activity()));
}

function pickSpawnPoint(): { tile: number; weight: number; wealth: number } {
  let r = rand.next() * rt.spawnWeightTotal;
  for (const p of rt.spawnPoints) {
    r -= p.weight;
    if (r <= 0) return p;
  }
  return rt.spawnPoints[rt.spawnPoints.length - 1];
}

function pickNeed(): string | null {
  let r = rand.next();
  for (const [id, t] of Object.entries(SHOP_TYPES)) {
    r -= t.demand;
    if (r < 0) return id;
  }
  return null;
}

function pickWants(typeId: string): string[] {
  const pool = [...SHOP_TYPES[typeId].products];
  const wants: string[] = [];
  const count = rand.pick([1, 1, 2, 2, 2, 3, 3, 4]);
  for (let i = 0; i < count && pool.length; i++) {
    let r = rand.next() * pool.reduce((a, p) => a + PRODUCTS[p].popularity, 0);
    const pi = pool.findIndex((p) => (r -= PRODUCTS[p].popularity) <= 0);
    wants.push(pool.splice(Math.max(0, pi), 1)[0]);
  }
  return wants;
}

function spawn(): Customer | null {
  const from = pickSpawnPoint();
  let to = pickSpawnPoint();
  for (let i = 0; i < 4 && to.tile === from.tile; i++) to = pickSpawnPoint();
  const g = rt.grid;
  const need = pickNeed();
  const c: Customer = {
    id: rt.nextCustomerId++,
    name: `${rand.pick(POPULATION.firstNames)} ${rand.pick(POPULATION.lastNames)}`,
    x: (from.tile % g.w) + 0.5,
    y: Math.floor(from.tile / g.w) + 0.5,
    ox: rand.range(-0.28, 0.28),
    oy: rand.range(-0.28, 0.28),
    look: rand.int(0, LOOKS - 1),
    state: 'walk',
    path: [],
    goal: to.tile,
    dest: to.tile,
    speed: POPULATION.walkSpeed * rand.range(0.85, 1.2),
    need,
    wants: need ? pickWants(need) : [],
    wantIndex: 0,
    cart: [],
    budget: Math.round(rand.range(POPULATION.budgetMin, POPULATION.budgetMax) * from.wealth),
    generosity: rand.range(0.3, 1.7),
    wealth: from.wealth,
    patience: rand.range(POPULATION.patienceMin, POPULATION.patienceMax),
    waited: 0,
    mood: rand.int(55, 75),
    thoughts: [],
    shopId: null,
    seen: [],
    timer: 0,
    shelfId: -1,
    slotIndex: -1,
    registerId: -1,
    queueSlot: -1,
    entered: false,
  };
  if (!setPath(c, to.tile)) return null;
  rt.customers.push(c);
  rt.byId.set(c.id, c);

  // Some shoppers already know where they are going: reputation brings them from across town.
  if (need) {
    const known = session.state.shops.filter((sh) => sh.type === need && isOpenNow(session.state, sh) && rand.chance((sh.reputation / 100) * 0.3));
    if (known.length) headToShop(c, rand.pick(known));
  }
  return c;
}

function despawn(c: Customer): void {
  leaveQueue(c);
  const i = rt.customers.indexOf(c);
  if (i >= 0) {
    rt.customers[i] = rt.customers[rt.customers.length - 1];
    rt.customers.pop();
  }
  rt.byId.delete(c.id);
  bus.emit('npc:removed', c.id);
}

// ---------- Helpers ----------

function setPath(c: Customer, goal: number): boolean {
  const g = rt.grid;
  const path = findPath(g, Math.floor(c.x), Math.floor(c.y), goal % g.w, Math.floor(goal / g.w));
  if (!path) return false;
  // Stored reversed so the next step is a cheap pop().
  c.path = path.reverse();
  c.goal = goal;
  return true;
}

function think(c: Customer, text: string, kind: ThoughtKind, moodDelta = 0): void {
  c.mood = clamp(c.mood + moodDelta, 0, 100);
  c.thoughts.push({ t: Math.floor(session.state.time.minutes), text, kind });
  if (c.thoughts.length > 10) c.thoughts.shift();
  bus.emit('npc:thought', { id: c.id, text, kind });
}

const productName = (p: string): string => PRODUCTS[p].name.toLowerCase();

function headToShop(c: Customer, shop: ShopState): boolean {
  const g = rt.grid;
  const lot = session.city.lots[shop.lotId];
  const ds = doors(shop, lot);
  if (!ds.length) return false;
  ds.sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y));
  if (!setPath(c, ds[0].y * g.w + ds[0].x)) return false;
  c.shopId = shop.id;
  c.state = 'toShop';
  return true;
}

/** Give up on shopping (or finish) and carry on to wherever they were going. */
function resumeWalk(c: Customer): void {
  leaveQueue(c);
  if (c.shopId !== null) c.seen.push(c.shopId);
  c.shopId = null;
  c.entered = false;
  c.state = c.need ? 'walk' : 'leave';
  if (!setPath(c, c.dest)) despawn(c);
}

function leaveQueue(c: Customer): void {
  if (c.registerId < 0 || c.shopId === null) return;
  const reg = rt.registers.get(regKey(c.shopId, c.registerId));
  if (reg) {
    const i = reg.queue.indexOf(c.id);
    if (i === 0) reg.progress = 0;
    if (i >= 0) reg.queue.splice(i, 1);
  }
  c.registerId = -1;
  c.queueSlot = -1;
}

/** Walk out of the shop for good, leaving an impression behind. */
function leaveShop(c: Customer, bought: boolean): void {
  const s = session.state;
  const shop = c.shopId !== null ? shopById(s, c.shopId) : undefined;
  if (shop && c.entered) {
    if (!bought) shop.today.walkouts++;
    // Each visit nudges reputation; purchases count for more than window-shopping.
    const delta = ((c.mood - 50) / 50) * (bought ? 0.6 : 0.45);
    shop.reputation = clamp(shop.reputation + delta, 0, 100);
  }
  if (shop && c.cart.length) {
    const today = dayOf(s.time);
    for (const l of c.cart) addToStorage(shop, l.product, l.qty, PRODUCTS[l.product].shelfLife ? today + 1 : 0);
    bus.emit('stock:changed', shop.id);
    c.cart = [];
  }
  c.need = null;
  resumeWalk(c);
}

// ---------- Shopping ----------

function considerShops(c: Customer): void {
  if (!c.need) return;
  const s = session.state;
  for (const shop of s.shops) {
    if (shop.type !== c.need || c.seen.includes(shop.id)) continue;
    const lot = session.city.lots[shop.lotId];
    const dx = Math.max(lot.x - c.x, 0, c.x - (lot.x + lot.w));
    const dy = Math.max(lot.y - c.y, 0, c.y - (lot.y + lot.h));
    if (Math.max(dx, dy) > POPULATION.noticeRadius) continue;
    c.seen.push(shop.id);
    if (!isOpenNow(s, shop)) continue;
    // Reputation decides how tempting the shop looks from the street.
    if (!rand.chance(0.2 + 0.7 * (shop.reputation / 100))) continue;
    c.seen.pop();
    if (headToShop(c, shop)) return;
    c.seen.push(shop.id);
  }
}

function enterShop(c: Customer): void {
  const s = session.state;
  const shop = c.shopId !== null ? shopById(s, c.shopId) : undefined;
  if (!shop) return resumeWalk(c);
  if (!isOpenNow(s, shop)) {
    think(c, "Oh, it's closed.", 'neutral', -3);
    return resumeWalk(c);
  }
  c.entered = true;
  shop.today.customers++;
  // First impressions: decor lifts the mood, dirt drags it down. Every visitor leaves a little mess.
  c.mood = clamp(c.mood + clamp(decorScore(shop) * 25, -10, 12) - shop.dirt * 0.18, 0, 100);
  if (shop.dirt > 55) think(c, 'This place is filthy.', 'bad', -4);
  const bins = shop.objects.filter((o) => defOf(o).kind === 'bin').length;
  shop.dirt = clamp(shop.dirt + 0.4 * (1 - Math.min(0.45, bins * 0.15)), 0, 100);
  c.state = 'browse';
  c.timer = rand.range(0.2, 0.6);
  bus.emit('door:enter', { shopId: shop.id });
}

function nextWant(c: Customer): void {
  const shop = c.shopId !== null ? shopById(session.state, c.shopId) : undefined;
  if (!shop) return resumeWalk(c);
  if (c.wantIndex >= c.wants.length) return checkout(c, shop);
  const product = c.wants[c.wantIndex];
  const g = rt.grid;

  const options: { obj: PlacedObject; slot: number; qty: number }[] = [];
  for (const obj of shop.objects) obj.slots?.forEach((sl, i) => sl.product === product && options.push({ obj, slot: i, qty: batchQty(sl.batches) }));
  const fail = (text: string, mood: number): void => {
    think(c, text, 'bad', mood);
    c.wantIndex++;
    c.state = 'browse';
    c.timer = rand.range(0.4, 0.9);
  };
  if (!options.length) {
    // Not sold here at all. Some shoppers settle for something else that is on the shelves.
    const alternatives = new Set<string>();
    for (const obj of shop.objects) for (const sl of obj.slots ?? []) if (sl.product && batchQty(sl.batches) > 0 && !c.wants.includes(sl.product)) alternatives.add(sl.product);
    if (alternatives.size && rand.chance(0.4)) {
      c.wants[c.wantIndex] = rand.pick([...alternatives]);
      c.timer = 0.3;
      return;
    }
    return fail(`Can't find any ${productName(product)}.`, -5);
  }
  const stocked = options.filter((o) => o.qty > 0);
  if (!stocked.length) return fail(`They're out of ${productName(product)}!`, -9);

  stocked.sort((a, b) => Math.hypot(a.obj.x - c.x, a.obj.y - c.y) - Math.hypot(b.obj.x - c.x, b.obj.y - c.y));
  for (const o of stocked) {
    const spots = frontTiles(o.obj).filter((t) => walkable(g, t.x, t.y));
    if (!spots.length) continue;
    const spot = rand.pick(spots);
    if (!setPath(c, spot.y * g.w + spot.x)) continue;
    c.shelfId = o.obj.id;
    c.slotIndex = o.slot;
    c.state = 'toShelf';
    return;
  }
  fail(`I can't get to the ${productName(product)}.`, -10);
}

function evaluateShelf(c: Customer): void {
  const s = session.state;
  const shop = c.shopId !== null ? shopById(s, c.shopId) : undefined;
  if (!shop) return resumeWalk(c);
  const product = c.wants[c.wantIndex];
  const slot = shop.objects.find((o) => o.id === c.shelfId)?.slots?.[c.slotIndex];
  c.state = 'browse';
  c.timer = rand.range(0.2, 0.6);
  // The shelf may have been emptied, moved or reassigned while they walked over.
  if (!slot || slot.product !== product || batchQty(slot.batches) <= 0) return;

  const price = shop.prices[product];
  const ratio = price / marketPrice(s, product);
  const maxRatio = 1 + 0.2 * c.wealth * c.generosity;
  const spent = c.cart.reduce((a, l) => a + l.qty * l.price, 0);
  c.wantIndex++;
  if (ratio > maxRatio) {
    think(c, ratio > maxRatio + 0.3 ? `What a rip-off! ${PRODUCTS[product].name} for $${price.toFixed(2)}?` : 'Too expensive!', 'bad', ratio > maxRatio + 0.3 ? -20 : -12);
    return;
  }
  if (price > c.budget - spent) {
    think(c, "I can't afford that.", 'neutral', -4);
    return;
  }
  let qty = 1;
  if (price < 3 && rand.chance(0.3)) qty++;
  if (ratio < 0.9 && rand.chance(0.5)) qty++;
  qty = Math.min(qty, Math.floor((c.budget - spent) / price));
  const taken = takeFromSlot(shop, slot, qty);
  if (!taken) return;
  c.cart.push({ product, qty: taken, price });
  if (ratio < 0.9) think(c, 'What a bargain!', 'good', 6);
}

function checkout(c: Customer, shop: ShopState): void {
  const s = session.state;
  if (!c.cart.length) {
    if (!c.thoughts.some((t) => t.kind === 'bad')) think(c, 'Nothing I wanted here.', 'neutral', -5);
    return leaveShop(c, false);
  }
  const open: RegisterRuntime[] = [];
  for (const obj of registers(shop)) {
    const reg = rt.registers.get(regKey(shop.id, obj.id));
    if (reg && reg.slots.length && operatorSpeed(s, shop, obj) > 0) open.push(reg);
  }
  if (!open.length) {
    think(c, registers(shop).length ? "There's nobody at the checkout!" : "There's nowhere to pay!", 'bad', -30);
    return leaveShop(c, false);
  }
  open.sort((a, b) => a.queue.length - b.queue.length);
  const reg = open[0];
  if (reg.queue.length >= reg.slots.length + 2) {
    think(c, 'That queue is far too long!', 'bad', -20);
    return leaveShop(c, false);
  }
  reg.queue.push(c.id);
  c.registerId = reg.objectId;
  c.queueSlot = -1;
  c.waited = 0;
  c.state = 'toQueue';
}

function completeSale(c: Customer, shop: ShopState, obj: PlacedObject): void {
  const s = session.state;
  const total = Math.round(c.cart.reduce((a, l) => a + l.qty * l.price, 0) * 100) / 100;
  const units = cartUnits(c);
  earn(s, total, 'sales');
  shop.today.revenue += total;
  shop.today.unitsSold += units;
  shop.today.served++;
  c.budget -= total;
  const avgRatio = c.cart.reduce((a, l) => a + (l.price / marketPrice(s, l.product)) * l.qty, 0) / units;
  c.cart = [];
  // A friendly (or surly) cashier colours the whole visit.
  const cashier = cashierAt(s, shop.id, obj.id);
  if (cashier) {
    const f = skill(cashier, 'friendliness');
    c.mood = clamp(c.mood + (f - 5) * 1.6, 0, 100);
    if (f <= 2 && rand.chance(0.5)) think(c, 'The cashier was so rude.', 'bad', -6);
  }
  if (c.waited < 1.5) think(c, 'Great service!', 'good', 10);
  else if (c.waited > c.patience * 0.6) think(c, 'That took forever.', 'bad', -10);
  else if (avgRatio < 0.97) think(c, 'Good prices here.', 'good', 6);
  else if (c.wantIndex && c.thoughts.every((t) => t.kind !== 'bad')) think(c, 'Got everything I needed.', 'good', 5);
  bus.emit('sale', { shopId: shop.id, amount: total, x: obj.x, y: obj.y });
  leaveShop(c, true);
}

function updateRegisters(dt: number): void {
  const s = session.state;
  for (const reg of rt.registers.values()) {
    if (!reg.queue.length) continue;
    const shop = shopById(s, reg.shopId);
    const obj = shop?.objects.find((o) => o.id === reg.objectId);
    if (!shop || !obj) continue;

    for (let i = reg.queue.length - 1; i >= 0; i--) {
      const c = rt.byId.get(reg.queue[i]);
      if (!c) {
        reg.queue.splice(i, 1);
        continue;
      }
      c.waited += dt;
      if (c.waited > c.patience && i > 0) {
        think(c, "I've waited long enough. Forget it!", 'bad', -25);
        leaveShop(c, false);
        continue;
      }
      const want = Math.min(i, reg.slots.length - 1);
      if (c.queueSlot !== want) {
        c.queueSlot = want;
        c.state = 'toQueue';
        if (!setPath(c, reg.slots[want])) c.state = 'queue';
      }
    }

    const first = rt.byId.get(reg.queue[0]);
    if (!first || first.state !== 'queue' || first.queueSlot !== 0) continue;
    const speed = operatorSpeed(s, shop, obj);
    if (speed <= 0) {
      if (first.waited > first.patience) {
        think(first, "There's nobody at the checkout!", 'bad', -30);
        leaveShop(first, false);
      }
      continue;
    }
    reg.progress += dt * speed;
    const needed = (0.5 + 0.2 * cartUnits(first)) * ((defOf(obj).checkoutSeconds ?? 9) / 9);
    if (reg.progress >= needed) {
      reg.progress = 0;
      reg.queue.shift();
      first.registerId = -1;
      first.queueSlot = -1;
      completeSale(first, shop, obj);
    }
  }
}

// ---------- Per-frame update ----------

function arrive(c: Customer): void {
  switch (c.state) {
    case 'walk':
    case 'leave':
      return despawn(c);
    case 'toShop':
      return enterShop(c);
    case 'toShelf':
      c.state = 'pick';
      c.timer = rand.range(1.2, 3.2);
      return;
    case 'toQueue':
      c.state = 'queue';
      return;
  }
}

/** Advance every pedestrian by `dt` game minutes. */
export function updateAi(dt: number): void {
  if (dt <= 0) return;
  const g = rt.grid;

  // Keep the population near its target for the time of day.
  const target = targetPopulation();
  if (rt.customers.length < target) {
    rt.spawnDebt += dt * Math.max(1, target / 14);
    let budget = 6;
    while (rt.spawnDebt >= 1 && budget-- > 0 && rt.customers.length < target) {
      rt.spawnDebt--;
      spawn();
    }
    rt.spawnDebt = Math.min(rt.spawnDebt, 6);
  }

  updateRegisters(dt);

  for (let i = rt.customers.length - 1; i >= 0; i--) {
    const c = rt.customers[i];
    if (c.state === 'browse' || c.state === 'pick') {
      c.timer -= dt;
      if (c.timer <= 0) {
        if (c.state === 'browse') nextWant(c);
        else evaluateShelf(c);
      }
      continue;
    }
    if (c.state === 'queue') continue;

    let dist = c.speed * dt;
    while (dist > 0 && c.path.length) {
      const n = c.path[c.path.length - 1];
      if (g.cost[n] === 0) {
        // Something was built in the way since the route was planned.
        if (!setPath(c, c.goal)) resumeWalk(c);
        break;
      }
      const tx = (n % g.w) + 0.5;
      const ty = Math.floor(n / g.w) + 0.5;
      const d = Math.hypot(tx - c.x, ty - c.y);
      if (d <= dist) {
        c.x = tx;
        c.y = ty;
        c.path.pop();
        dist -= d;
        if (c.state === 'walk' && c.need) {
          considerShops(c);
          if (c.state !== 'walk') break;
        }
      } else {
        c.x += ((tx - c.x) / d) * dist;
        c.y += ((ty - c.y) / d) * dist;
        dist = 0;
      }
    }
    if (!c.path.length && rt.byId.has(c.id)) arrive(c);
  }
}
