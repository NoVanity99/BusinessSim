import { bus } from '../../core/events';
import { couponCut } from '../marketing/marketing';
import { calendarPriceSense } from '../world/seasons';
import { clamp } from '../../core/format';
import { rand } from '../../core/rng';
import { session, shopById } from '../../core/state';
import { DIFFICULTIES, NEIGHBORHOODS, POPULATION, PRODUCTS, SHOP_TYPES } from '../../data';
import { breakMult, registerSpeedMult } from '../shop/modifiers';
import { cartUnits, type Customer, type Step, type ThoughtKind } from '../../entities/Customer';
import { recordSale } from '../../entities/Shop';
import { batchQty, decorScore, defOf, DIRS, doors, footprint, frontTiles, registers, type PlacedObject, type ShopState } from '../../entities/Shop';
import { idx, T } from '../city/generate';
import { earn } from '../economy/finance';
import { addToStorage, consumeIngredients, hasIngredients, takeFromSlot } from '../economy/stock';
import { fairPrice } from '../shop/pricing';
import { weatherCrowd, weatherDef, weatherProductBoost } from '../world/weather';
import { PERSONAS } from '../../data';
import { afterVisit, appetite, chooseNeed, chooseShop, generateResidents, metElsewhere, personaOf, pruneMemories, type Resident } from './residents';
import { ADULT_LOOKS, CHILD_LOOKS } from '../../art/looks';
import { shopDemandMult } from '../events/events';
import { kitchenCanMake, openTicket, updateKitchens } from '../shop/kitchen';
import { onDuty } from '../staff/staff';
import { toast } from '../../core/events';
import { spend } from '../economy/finance';
import { isOpenNow, operatorSpeed } from '../shop/status';
import { dayOf, hourFloat, isWeekend } from '../time/clock';
import { buildGrid, rebuildLot, walkable } from './grid';
import { findPath } from './pathfind';
import { regKey, rt, type RegisterRuntime } from './runtime';
import { cashierAt, prioritiesOf, registerCovered, staffLayoutChanged } from '../staff/agents';
import { allRivalShops, frontTile, rivalById, rivalPrice } from '../rivals/rivals';
import { upgradeLevel } from '../progress/upgrades';
import { EVENTS } from '../../data';
import { news } from '../events/events';
import { money } from '../../core/format';
import { skill } from '../staff/staff';

const MAX_QUEUE_SLOTS = 8;
let crowdClock = 0;

// ---------- Setup ----------

export function initAi(): void {
  const { city } = session;
  rt.grid = buildGrid(city);
  rt.customers = [];
  rt.byId = new Map();
  rt.registers = new Map();
  rt.staff = new Map();
  rt.stations = new Map();
  rt.out = new Set();
  rt.crowd = new Uint8Array(city.w * city.h);
  rt.heat = new Float32Array(city.w * city.h);
  rt.kitchens = new Map();
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
  // A new game, or a save from before residents existed: move people in.
  if (!session.state.residents.length) generateResidents(session.state, rt.spawnPoints);
  pruneMemories(session.state);

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
      // Their line may have moved or vanished; make the same decision again.
      leaveQueue(c);
      c.state = 'browse';
      c.timer = 0.1;
    } else if (c.state === 'toShelf' || c.state === 'pick' || c.state === 'toStation' || c.state === 'waitStation') {
      releaseStation(c);
      c.state = 'browse';
      c.timer = 0.1;
      c.path = [];
    } else if (c.state === 'using' || c.state === 'awaitOrder') {
      // Carry on where they are, unless what they were using has gone.
      if (c.stationId >= 0 && !shop.objects.some((o) => o.id === c.stationId)) {
        releaseStation(c);
        c.state = 'browse';
        c.timer = 0.1;
      }
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
  return Math.min(POPULATION.maxPopulation, Math.round(POPULATION.basePopulation * activity() * rt.crowdMult * weatherCrowd(session.state)));
}

function pickSpawnPoint(): { tile: number; weight: number; wealth: number } {
  let r = rand.next() * rt.spawnWeightTotal;
  for (const p of rt.spawnPoints) {
    r -= p.weight;
    if (r <= 0) return p;
  }
  return rt.spawnPoints[rt.spawnPoints.length - 1];
}

/** Pick a product by popularity, weather, and (if given) what this kind of person favours. */
function weightedPick(pool: string[], likes?: string[]): string {
  // Weather shifts what people fancy: ice cream in a heatwave, tea in the snow.
  const weight = (p: string): number => PRODUCTS[p].popularity * weatherProductBoost(session.state, p) * (likes?.includes(p) ? 2.5 : 1);
  let r = rand.next() * pool.reduce((a, p) => a + weight(p), 0);
  return pool.find((p) => (r -= weight(p)) <= 0) ?? pool[0];
}

function pickSeveral(pool: string[], count: number, likes?: string[]): string[] {
  const left = [...pool];
  const out: string[] = [];
  while (out.length < count && left.length) out.push(left.splice(left.indexOf(weightedPick(left, likes)), 1)[0]);
  return out;
}

const kindOf = (p: string): string => PRODUCTS[p].kind ?? 'good';
const isShelfGood = (p: string): boolean => ['good', 'collectible', 'crafted'].includes(kindOf(p));

/** Build the list of things a customer means to do, from the kind of business they are after. */
function makePlan(typeId: string, persona: string, kids: number): Step[] {
  const type = SHOP_TYPES[typeId];
  const P = personaOf(persona);
  // Bigger spenders set out to buy more things.
  const count = (options: number[]): number => Math.max(1, Math.round(rand.pick(options) * P.basket));
  // Children ask for their favourites, if this place sells them.
  const treats = (P.kidsWant ?? []).filter((p) => type.products.includes(p));
  const goods = type.products.filter(isShelfGood);
  const plan: Step[] = [];
  switch (type.flow) {
    case 'counter':
      plan.push({ t: 'order', items: [...new Set([...pickSeveral(type.products.filter((p) => kindOf(p) === 'menu'), count([1, 1, 2, 2, 3]), P.likes), ...(kids ? treats.filter((p) => kindOf(p) === 'menu').slice(0, kids) : [])])] });
      plan.push({ t: 'use', service: 'seat', optional: true });
      break;
    case 'service':
      if (goods.length && rand.chance(type.planFree ? 0.45 : 0.3)) plan.push({ t: 'buy', product: weightedPick(goods, P.likes) });
      if (type.planFree) {
        // An arcade: a few games on whatever takes their fancy and happens to be free.
        const games = count([2, 2, 3, 3, 4]);
        for (let i = 0; i < games; i++) plan.push({ t: 'use', service: weightedPick(type.plan ?? [], P.likes), optional: true });
      } else for (const svc of type.plan ?? []) plan.push({ t: 'use', service: svc });
      plan.push({ t: 'pay' });
      break;
    case 'park': {
      plan.push({ t: 'use', service: 'svc_ticket' });
      const rides = rand.int(3, 6);
      for (let i = 0; i < rides; i++) {
        plan.push({ t: 'use', service: 'ride', optional: true });
        if (i === 1 && rand.chance(0.6)) plan.push({ t: 'use', service: 'svc_snack', optional: true }, { t: 'use', service: 'seat', optional: true });
        if (rand.chance(0.25)) plan.push({ t: 'use', service: 'svc_arcade', optional: true });
      }
      break;
    }
    default: {
      let wants = pickSeveral(goods, count([1, 1, 2, 2, 2, 3, 3, 4]), P.likes);
      if (kids) wants = [...new Set([...wants, ...treats.filter(isShelfGood).slice(0, kids)])];
      // Collectors come for the valuable singles and little else.
      if (persona === 'collector') wants = [...new Set([rand.chance(0.35) ? 'single_ultra' : 'single_rare', ...wants.slice(0, 1)])].filter((p) => type.products.includes(p));
      for (const product of wants) plan.push({ t: 'buy', product });
      plan.push({ t: 'pay' });
      for (const svc of type.after ?? []) if (rand.chance(0.35)) plan.push({ t: 'use', service: svc, optional: true });
    }
  }
  return plan;
}

/** A resident who is at home and could go out now, or null if everyone we tried is already out. */
function pickResident(): Resident | null {
  const list = session.state.residents;
  for (let i = 0; i < 6 && list.length; i++) {
    const r = rand.pick(list);
    if (!rt.out.has(r.id)) return r;
  }
  return null;
}

function spawn(crook?: { shop: ShopState; kind: 'steal' | 'vandal' }): Customer | null {
  const s = session.state;
  // Most people on the street live here; some are visitors with no history in the city.
  const resident = crook || rand.chance(PERSONAS.touristShare) ? null : pickResident();
  const persona = resident?.persona ?? 'tourist';
  const P = personaOf(persona);
  const from = resident ? { tile: resident.home, weight: 1, wealth: resident.wealth } : pickSpawnPoint();
  let to = pickSpawnPoint();
  for (let i = 0; i < 4 && to.tile === from.tile; i++) to = pickSpawnPoint();
  const g = rt.grid;
  const need = crook ? crook.shop.type : chooseNeed(s, resident, persona);
  // Families bring children, students and tourists bring friends.
  const companions: number[] = [];
  if (!crook && P.group && rand.chance(P.group[0])) {
    const n = rand.int(P.group[1], P.group[2]);
    for (let i = 0; i < n; i++) companions.push(P.group[3] === 'child' ? rand.pick(CHILD_LOOKS) : rand.pick(ADULT_LOOKS));
  }
  const kids = P.group?.[3] === 'child' ? companions.length : 0;
  const c: Customer = {
    id: rt.nextCustomerId++,
    name: resident?.name ?? `${rand.pick(POPULATION.firstNames)} ${rand.pick(POPULATION.lastNames)}`,
    x: (from.tile % g.w) + 0.5,
    y: Math.floor(from.tile / g.w) + 0.5,
    ox: rand.range(-0.28, 0.28),
    oy: rand.range(-0.28, 0.28),
    look: resident?.look ?? rand.pick(ADULT_LOOKS),
    state: 'walk',
    path: [],
    goal: to.tile,
    dest: to.tile,
    speed: POPULATION.walkSpeed * rand.range(0.85, 1.2) * (companions.length ? 0.9 : 1),
    need,
    plan: crook ? [{ t: crook.kind }] : need ? makePlan(need, persona, kids) : [],
    step: 0,
    cart: [],
    budget: Math.round(rand.range(POPULATION.budgetMin, POPULATION.budgetMax) * from.wealth * P.budget * (need === 'funpark' ? 1.6 : 1) * (1 + companions.length * 0.4)),
    // Price-conscious personas tolerate less markup.
    generosity: rand.range(0.5, 1.5) / P.priceSense,
    wealth: from.wealth,
    patience: rand.range(POPULATION.patienceMin, POPULATION.patienceMax) * DIFFICULTIES[s.difficulty].patienceMult * P.patience,
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
    stationId: -1,
    seatId: -1,
    used: [],
    bought: false,
    residentId: resident?.id ?? -1,
    persona,
    companions,
    elsewhere: false,
    rivalId: -1,
    crook: !!crook,
    loot: [],
    fleeing: false,
    fleeFrom: -1,
  };
  if (!setPath(c, to.tile)) return null;
  rt.customers.push(c);
  rt.byId.set(c.id, c);
  if (resident) rt.out.add(resident.id);

  // Decide where to go for it: one of your shops, or somewhere else in town.
  if (crook) {
    if (!headToShop(c, crook.shop)) {
      despawn(c);
      return null;
    }
  } else if (need) {
    const { shop, rival } = chooseShop(s, resident, persona, need, from.tile);
    if (shop) headToShop(c, shop);
    else {
      c.elsewhere = true;
      // Walk to the rival's door, where everyone can see the custom going there.
      const door = rival ? frontTile(session.city, session.city.lots[rival.lotId]) : -1;
      if (rival && setPath(c, door)) {
        c.dest = door;
        c.rivalId = rival.id;
      }
    }
  }
  return c;
}

function despawn(c: Customer): void {
  leaveQueue(c);
  releaseStation(c);
  rt.out.delete(c.residentId);
  // Whoever went elsewhere got what they were after; their need starts building again.
  if (c.elsewhere && !c.entered) metElsewhere(session.state, c.residentId, c.need);
  // Count the visit for the rival they walked to.
  if (c.elsewhere && c.rivalId >= 0 && !c.path.length) {
    const rival = rivalById(session.state, c.rivalId);
    if (rival) rival.today++;
  }
  if (c.loot.length) gotAway(c);
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
  const path = findPath(g, Math.floor(c.x), Math.floor(c.y), goal % g.w, Math.floor(goal / g.w), rt.crowd.length ? rt.crowd : undefined);
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
/** What a customer pays for something here today, after any coupons. */
const priceFor = (shop: ShopState, product: string): number => Math.round(shop.prices[product] * (1 - couponCut(session.state, shop)) * 100) / 100;
const shopOf = (c: Customer): ShopState | undefined => (c.shopId !== null ? shopById(session.state, c.shopId) : undefined);

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
  releaseStation(c);
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

function releaseStation(c: Customer): void {
  if (c.shopId === null) return;
  for (const id of [c.stationId, c.seatId]) {
    if (id < 0) continue;
    const users = rt.stations.get(regKey(c.shopId, id));
    const i = users ? users.indexOf(c.id) : -1;
    if (i >= 0) users!.splice(i, 1);
  }
  c.stationId = -1;
  c.seatId = -1;
}

/** Walk out of the shop for good, leaving an impression behind. */
function leaveShop(c: Customer): void {
  const s = session.state;
  const shop = shopOf(c);
  if (shop && c.entered && !c.crook) {
    if (!c.bought) shop.today.walkouts++;
    else shop.today.served++;
    // Each visit nudges reputation; paying customers count for more than window-shoppers.
    const delta = ((c.mood - 50) / 50) * (c.bought ? 0.6 : 0.45);
    shop.reputation = clamp(shop.reputation + delta, 0, 100);
    shop.moodAvg = (shop.moodAvg ?? 60) * 0.9 + c.mood * 0.1;
    afterVisit(s, shop, c);
    bus.emit('visit:ended', { shopId: shop.id, mood: c.mood, bought: c.bought });
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

/** Take payment for something that is not rung up at a checkout. */
function charge(c: Customer, shop: ShopState, amount: number, category: 'sales' | 'services', at: { x: number; y: number }): void {
  earn(session.state, amount, category);
  shop.today.revenue += amount;
  c.budget -= amount;
  c.bought = true;
  bus.emit('sale', { shopId: shop.id, amount, x: at.x, y: at.y });
}

/** Does the customer accept this price? Thinks out loud and returns false if not. */
function acceptsPrice(c: Customer, shop: ShopState, product: string, price: number): boolean {
  const ratio = price / fairPrice(session.state, shop, product);
  // On sale days everyone is hunting for a bargain.
  const maxRatio = 1 + (0.2 * c.wealth * c.generosity) / calendarPriceSense(session.state);
  if (ratio > maxRatio) {
    const outrageous = ratio > maxRatio + 0.3;
    // People know what the competition charges.
    const cheaper = allRivalShops(session.state).find((r) => r.type === shop.type && rivalPrice(session.state, r) < ratio - 0.05);
    think(c, outrageous ? `What a rip-off! $${price.toFixed(2)} for ${productName(product)}?` : cheaper && rand.chance(0.6) ? `Too expensive! It's cheaper at ${cheaper.name}.` : 'Too expensive!', 'bad', outrageous ? -20 : -12);
    return false;
  }
  if (price > c.budget - c.cart.reduce((a, l) => a + l.qty * l.price, 0)) {
    think(c, "I can't afford that.", 'neutral', -4);
    return false;
  }
  if (ratio < 0.9) think(c, 'What a bargain!', 'good', 6);
  return true;
}

// ---------- Arriving ----------

function considerShops(c: Customer): void {
  if (!c.need) return;
  const s = session.state;
  for (const shop of s.shops) {
    if (shop.type !== c.need || c.seen.includes(shop.id)) continue;
    const lot = session.city.lots[shop.lotId];
    const dx = Math.max(lot.x - c.x, 0, c.x - (lot.x + lot.w));
    const dy = Math.max(lot.y - c.y, 0, c.y - (lot.y + lot.h));
    if (Math.max(dx, dy) > POPULATION.noticeRadius * (weatherDef(s).notice ?? 1)) continue;
    c.seen.push(shop.id);
    if (!isOpenNow(s, shop)) continue;
    // Reputation decides how tempting the shop looks from the street.
    const resident = c.residentId >= 0 ? s.residents.find((r) => r.id === c.residentId) ?? null : null;
    const keen = clamp(appetite(s, resident, c.persona, shop.type), 0.4, 1.4);
    // Someone who has been badly let down here walks straight past.
    if ((resident?.memory[shop.id]?.score ?? 0) < -0.5) continue;
    if (!rand.chance((0.2 + 0.7 * (shop.reputation / 100)) * shopDemandMult(s, shop) * keen * (c.elsewhere ? 0.6 : 1))) continue;
    c.seen.pop();
    if (headToShop(c, shop)) {
      c.elsewhere = false;
      c.rivalId = -1;
      return;
    }
    c.seen.push(shop.id);
  }
}

function enterShop(c: Customer): void {
  const s = session.state;
  const shop = shopOf(c);
  if (!shop) return resumeWalk(c);
  if (!isOpenNow(s, shop)) {
    think(c, "Oh, it's closed.", 'neutral', -3);
    return resumeWalk(c);
  }
  c.entered = true;
  if (c.crook) {
    c.state = 'browse';
    c.timer = rand.range(0.4, 1.2);
    return;
  }
  shop.today.customers++;
  (shop.today.byHour ??= new Array(24).fill(0))[Math.floor(hourFloat(s.time)) % 24]++;
  // First impressions: decor lifts the mood, dirt drags it down. Every visitor leaves a little mess.
  const fussy = personaOf(c.persona).ambience ?? 1;
  c.mood = clamp(c.mood + (clamp(decorScore(shop) * 25, -10, 12) - shop.dirt * 0.18) * fussy, 0, 100);
  if (c.companions.length && personaOf(c.persona).kidsWant && rand.chance(0.4)) think(c, rand.pick(['The kids want sweets.', 'Stay close, you two.', 'One treat each, that is all.']), 'neutral');
  if (shop.dirt > 55) think(c, 'This place is filthy.', 'bad', -4);
  const bins = shop.objects.filter((o) => defOf(o).kind === 'bin').length;
  shop.dirt = clamp(shop.dirt + 0.4 * (1 - Math.min(0.45, bins * 0.15)), 0, 100);
  c.state = 'browse';
  c.timer = rand.range(0.2, 0.6);
  bus.emit('door:enter', { shopId: shop.id });
}

/** Move on to whatever is next on the customer's list. */
function nextStep(c: Customer): void {
  const shop = shopOf(c);
  if (!shop) return resumeWalk(c);
  const step = c.plan[c.step];
  if (!step) return leaveShop(c);
  switch (step.t) {
    case 'buy':
      return goToShelf(c, shop, step);
    case 'pay':
      return checkout(c, shop);
    case 'order':
      return joinQueue(c, shop, "There's nobody taking orders!");
    case 'use':
      return goToStation(c, shop, step);
    case 'steal':
    case 'vandal':
      return goToTarget(c, shop, step.t);
  }
}

function skip(c: Customer, pause = 0.4): void {
  c.step++;
  c.state = 'browse';
  c.timer = rand.range(pause, pause * 2);
}

// ---------- Shelves ----------

function goToShelf(c: Customer, shop: ShopState, step: Extract<Step, { t: 'buy' }>): void {
  const g = rt.grid;
  const product = step.product;
  const options: { obj: PlacedObject; slot: number; qty: number }[] = [];
  for (const obj of shop.objects) {
    if (defOf(obj).kind !== 'shelf') continue;
    obj.slots?.forEach((sl, i) => sl.product === product && options.push({ obj, slot: i, qty: batchQty(sl.batches) }));
  }
  if (!options.length) {
    // Not sold here at all. Some shoppers settle for something else that is on the shelves.
    const wanted = new Set(c.plan.map((p) => (p.t === 'buy' ? p.product : '')));
    const alternatives = new Set<string>();
    for (const obj of shop.objects) {
      if (defOf(obj).kind !== 'shelf') continue;
      for (const sl of obj.slots ?? []) if (sl.product && batchQty(sl.batches) > 0 && !wanted.has(sl.product)) alternatives.add(sl.product);
    }
    if (alternatives.size && rand.chance(0.4)) {
      // Something similar if there is any, otherwise whatever takes their fancy.
      const similar = [...alternatives].filter((p) => PRODUCTS[p].category === PRODUCTS[product].category);
      step.product = rand.pick(similar.length ? similar : [...alternatives]);
      c.timer = 0.3;
      return;
    }
    think(c, `Can't find any ${productName(product)}.`, 'bad', -5);
    return skip(c);
  }
  const stocked = options.filter((o) => o.qty > 0);
  if (!stocked.length) {
    think(c, `They're out of ${productName(product)}!`, 'bad', -9);
    return skip(c);
  }
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
  think(c, `I can't get to the ${productName(product)}.`, 'bad', -10);
  skip(c);
}

function evaluateShelf(c: Customer): void {
  const shop = shopOf(c);
  if (!shop) return resumeWalk(c);
  if (c.crook) return commitCrime(c, shop);
  const step = c.plan[c.step];
  c.state = 'browse';
  c.timer = rand.range(0.2, 0.6);
  if (step?.t !== 'buy') return;
  const product = step.product;
  const slot = shop.objects.find((o) => o.id === c.shelfId)?.slots?.[c.slotIndex];
  // The shelf may have been emptied, moved or reassigned while they walked over; look again.
  if (!slot || slot.product !== product || batchQty(slot.batches) <= 0) return;
  c.step++;
  const price = priceFor(shop, product);
  if (!acceptsPrice(c, shop, product, price)) return;
  const spent = c.cart.reduce((a, l) => a + l.qty * l.price, 0);
  let qty = 1;
  if (price < 3 && rand.chance(0.3)) qty++;
  if (price / fairPrice(session.state, shop, product) < 0.9 && rand.chance(0.5)) qty++;
  if (product === 'booster') qty += rand.int(0, 3);
  qty = Math.min(qty, Math.floor((c.budget - spent) / price));
  const taken = takeFromSlot(shop, slot, qty);
  if (taken) c.cart.push({ product, qty: taken, price });
}

// ---------- Checkouts and counters ----------

function checkout(c: Customer, shop: ShopState): void {
  if (!c.cart.length) {
    // Nothing to ring up. Say so only if the whole trip was a bust.
    if (!c.bought && c.plan.some((p) => p.t === 'buy') && !c.thoughts.some((t) => t.kind === 'bad')) think(c, 'Nothing I wanted here.', 'neutral', -5);
    c.step++;
    c.state = 'browse';
    c.timer = 0.1;
    return;
  }
  // Self-service places (a detergent rack in a laundromat) take payment on trust.
  if (SHOP_TYPES[shop.type].flow === 'service' && !registers(shop).length) {
    const total = Math.round(c.cart.reduce((a, l) => a + l.qty * l.price, 0) * 100) / 100;
    shop.today.unitsSold += cartUnits(c);
    for (const l of c.cart) recordSale(shop, l.product, l.qty * l.price);
    c.cart = [];
    charge(c, shop, total, 'sales', { x: Math.floor(c.x), y: Math.floor(c.y) });
    c.step++;
    c.state = 'browse';
    c.timer = 0.2;
    return;
  }
  joinQueue(c, shop, "There's nobody at the checkout!");
}

/** On the way to the till, something within arm's reach may end up in the basket. */
function impulseBuy(c: Customer, shop: ShopState, registerId: number): void {
  const P = personaOf(c.persona);
  const reg = shop.objects.find((o) => o.id === registerId);
  if (!reg || !c.cart.length || !rand.chance(P.impulse)) return;
  for (const obj of shop.objects) {
    if (defOf(obj).kind !== 'shelf' || Math.hypot(obj.x - reg.x, obj.y - reg.y) > 2.6) continue;
    for (const slot of obj.slots ?? []) {
      const product = slot.product;
      if (!product || batchQty(slot.batches) <= 0 || c.cart.some((l) => l.product === product)) continue;
      const price = priceFor(shop, product);
      const spent = c.cart.reduce((a, l) => a + l.qty * l.price, 0);
      // Impulse buys are small: nothing dear, and only if the money is there.
      if (price > 8 || price > c.budget - spent || price > fairPrice(session.state, shop, product) * 1.4) continue;
      if (!takeFromSlot(shop, slot, 1)) continue;
      c.cart.push({ product, qty: 1, price });
      think(c, rand.pick(['Ooh, and one of these.', 'Go on then.', 'Why not.']), 'neutral', 2);
      return;
    }
  }
}

function joinQueue(c: Customer, shop: ShopState, nobody: string): void {
  const s = session.state;
  const open: RegisterRuntime[] = [];
  for (const obj of registers(shop)) {
    const reg = rt.registers.get(regKey(shop.id, obj.id));
    if (reg && reg.slots.length && operatorSpeed(s, shop, obj) > 0) open.push(reg);
  }
  // Nobody at a till right now, but someone on shift serves: queue up and they will come over.
  if (!open.length && registerCovered(s, shop)) for (const obj of registers(shop)) {
    const reg = rt.registers.get(regKey(shop.id, obj.id));
    if (reg && reg.slots.length) open.push(reg);
  }
  if (!open.length) {
    think(c, registers(shop).length ? nobody : "There's nowhere to pay!", 'bad', -30);
    return leaveShop(c);
  }
  open.sort((a, b) => a.queue.length - b.queue.length);
  const reg = open[0];
  if (reg.queue.length >= reg.slots.length + 2) {
    think(c, 'That queue is far too long!', 'bad', -20);
    return leaveShop(c);
  }
  impulseBuy(c, shop, reg.objectId);
  reg.queue.push(c.id);
  c.registerId = reg.objectId;
  c.queueSlot = -1;
  c.waited = 0;
  c.state = 'toQueue';
}

/** A friendly (or surly) cashier colours the whole visit. */
function cashierEffect(c: Customer, shop: ShopState, obj: PlacedObject): void {
  const cashier = cashierAt(session.state, shop.id, obj.id);
  if (!cashier) return;
  const f = skill(cashier, 'friendliness');
  c.mood = clamp(c.mood + (f - 5) * 1.6, 0, 100);
  if (f <= 2 && rand.chance(0.5)) think(c, 'The cashier was so rude.', 'bad', -6);
}

function completeSale(c: Customer, shop: ShopState, obj: PlacedObject): void {
  const s = session.state;
  const total = Math.round(c.cart.reduce((a, l) => a + l.qty * l.price, 0) * 100) / 100;
  const units = cartUnits(c);
  const avgRatio = c.cart.reduce((a, l) => a + (l.price / fairPrice(s, shop, l.product)) * l.qty, 0) / units;
  shop.today.unitsSold += units;
  for (const l of c.cart) recordSale(shop, l.product, l.qty * l.price);
  c.cart = [];
  charge(c, shop, total, 'sales', obj);
  cashierEffect(c, shop, obj);
  if (c.waited < 1.5) think(c, 'Great service!', 'good', 10);
  else if (c.waited > c.patience * 0.6) think(c, 'That took forever.', 'bad', -10);
  else if (avgRatio < 0.97) think(c, 'Good prices here.', 'good', 6);
  else if (c.thoughts.every((t) => t.kind !== 'bad')) think(c, 'Got everything I needed.', 'good', 5);
  c.step++;
  c.state = 'browse';
  c.timer = 0.2;
}

/** At the front of a counter: choose what to order, pay, and hand the ticket to the kitchen. */
function placeFoodOrder(c: Customer, shop: ShopState, obj: PlacedObject): void {
  const step = c.plan[c.step];
  if (step?.t !== 'order') return skip(c, 0.1);
  const lines: { product: string; price: number }[] = [];
  let unavailable = 0;
  for (const item of step.items) {
    if (!kitchenCanMake(shop, item) || !hasIngredients(shop, PRODUCTS[item].recipe)) {
      unavailable++;
      continue;
    }
    const price = priceFor(shop, item);
    c.cart.push(...lines.map((l) => ({ product: l.product, qty: 1, price: l.price })));
    const ok = acceptsPrice(c, shop, item, price);
    c.cart = [];
    if (ok && consumeIngredients(shop, PRODUCTS[item].recipe)) lines.push({ product: item, price });
  }
  if (unavailable) think(c, unavailable === step.items.length ? "They can't make anything I wanted!" : "They were out of some of what I wanted.", 'bad', unavailable === step.items.length ? -18 : -6);
  if (!lines.length) return leaveShop(c);
  const total = Math.round(lines.reduce((a, l) => a + l.price, 0) * 100) / 100;
  shop.today.unitsSold += lines.length;
  for (const l of lines) recordSale(shop, l.product, l.price);
  charge(c, shop, total, 'sales', obj);
  cashierEffect(c, shop, obj);
  openTicket(shop.id, c.id, lines.map((l) => l.product));
  c.waited = 0;
  c.state = 'awaitOrder';
  // Step aside so the next person can order.
  const g = rt.grid;
  const lot = session.city.lots[shop.lotId];
  for (let i = 0; i < 12; i++) {
    const tx = clamp(Math.floor(c.x) + rand.int(-2, 2), lot.x, lot.x + lot.w - 1);
    const ty = clamp(Math.floor(c.y) + rand.int(-2, 2), lot.y, lot.y + lot.h - 1);
    if (g.cost[ty * g.w + tx] === 10 && setPath(c, ty * g.w + tx)) break;
  }
}

/** Every item on a customer's ticket is ready. */
function orderReady(customerId: number, minutes: number): void {
  const c = rt.byId.get(customerId);
  if (!c || c.state !== 'awaitOrder') return;
  if (minutes < 4) think(c, 'That was quick!', 'good', 10);
  else if (minutes > c.patience * 0.8) think(c, 'Finally. That took ages.', 'bad', -10);
  else if (rand.chance(0.4)) think(c, 'Smells great.', 'good', 4);
  c.path = [];
  c.step++;
  c.state = 'browse';
  c.timer = 0.2;
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
        leaveShop(c);
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
        think(first, "There's nobody serving!", 'bad', -30);
        leaveShop(first);
      }
      continue;
    }
    reg.progress += dt * speed;
    const ordering = first.plan[first.step]?.t === 'order';
    const needed = (ordering ? 0.7 : 0.5 + 0.2 * cartUnits(first)) * ((defOf(obj).checkoutSeconds ?? 9) / 9) / registerSpeedMult(s, shop);
    if (reg.progress >= needed) {
      reg.progress = 0;
      reg.queue.shift();
      first.registerId = -1;
      first.queueSlot = -1;
      if (ordering) placeFoodOrder(first, shop, obj);
      else completeSale(first, shop, obj);
    }
  }
}

// ---------- Machines, seats and attractions ----------

const usersOf = (shopId: number, objId: number): number[] => {
  const key = regKey(shopId, objId);
  let users = rt.stations.get(key);
  if (!users) rt.stations.set(key, (users = []));
  return users;
};

function stationMatches(obj: PlacedObject, service: string): boolean {
  const d = defOf(obj);
  if (d.vehicle) return false;
  return service === 'seat' ? d.kind === 'seat' : d.kind === 'service' && d.service === service;
}

/** Walkable tiles touching an object's footprint. */
function tilesAround(obj: PlacedObject): number[] {
  const g = rt.grid;
  const { w, h } = footprint(obj.def, obj.rot);
  const out: number[] = [];
  for (let x = obj.x - 1; x <= obj.x + w; x++) {
    for (let y = obj.y - 1; y <= obj.y + h; y++) {
      const edge = x < obj.x || x >= obj.x + w || y < obj.y || y >= obj.y + h;
      const corner = (x < obj.x || x >= obj.x + w) && (y < obj.y || y >= obj.y + h);
      if (edge && !corner && walkable(g, x, y)) out.push(y * g.w + x);
    }
  }
  return out;
}

const SERVICE_NAMES: Record<string, string> = { seat: 'seat', ride: 'ride', play: 'table', svc_wash: 'washer', svc_dry: 'dryer', svc_ticket: 'ticket gate', svc_arcade: 'arcade machine', svc_pinball: 'pinball table', svc_airhockey: 'air hockey table', svc_snack: 'snack stall' };

function goToStation(c: Customer, shop: ShopState, step: Extract<Step, { t: 'use' }>): void {
  const s = session.state;
  const svc = step.service;
  const all = shop.objects.filter((o) => stationMatches(o, svc));
  const name = SERVICE_NAMES[svc] ?? 'machine';
  if (!all.length) {
    if (step.optional) return skip(c, 0.1);
    think(c, `There's no ${name} here!`, 'bad', -20);
    return leaveShop(c);
  }
  const working = all.filter((o) => !o.broken && (!defOf(o).needsRole || s.staff.some((e) => e.shopId === shop.id && e.role === defOf(o).needsRole && onDuty(s, e))));
  if (!working.length) {
    think(c, all.length > 1 ? `Every ${name} is out of order!` : `The ${name} is out of order!`, 'bad', step.optional ? -8 : -22);
    return step.optional ? skip(c) : leaveShop(c);
  }
  let free = working.filter((o) => usersOf(shop.id, o.id).length < (defOf(o).capacity ?? 1));
  if (!free.length) {
    c.waited += 1;
    if (c.waited > c.patience * (step.optional ? 0.4 : 1.2)) {
      c.waited = 0;
      if (step.optional) {
        if (svc !== 'seat') think(c, `The queue for the ${name} is too long.`, 'bad', -5);
        else think(c, 'Nowhere to sit.', 'bad', -5);
        return skip(c);
      }
      think(c, `Every ${name} is taken. I'm not waiting any longer.`, 'bad', -22);
      return leaveShop(c);
    }
    c.state = 'waitStation';
    c.timer = 1;
    return;
  }
  // Guests prefer attractions they have not been on yet, and the more exciting ones.
  const fresh = free.filter((o) => !c.used.includes(o.id));
  if (fresh.length) free = fresh;
  free.sort((a, b) => (defOf(b).fun ?? 0) + rand.range(0, 6) - ((defOf(a).fun ?? 0) + rand.range(0, 6)));
  for (const obj of free) {
    const spots = tilesAround(obj);
    if (!spots.length || !setPath(c, rand.pick(spots))) continue;
    usersOf(shop.id, obj.id).push(c.id);
    c.stationId = obj.id;
    c.waited = 0;
    c.state = 'toStation';
    return;
  }
  if (step.optional) return skip(c);
  think(c, `I can't get to the ${name}.`, 'bad', -15);
  leaveShop(c);
}

function startUsing(c: Customer): void {
  const s = session.state;
  const shop = shopOf(c);
  const step = c.plan[c.step];
  const obj = shop?.objects.find((o) => o.id === c.stationId);
  if (!shop || !obj || step?.t !== 'use' || obj.broken) {
    releaseStation(c);
    c.state = 'browse';
    c.timer = 0.2;
    return;
  }
  const d = defOf(obj);
  const product = PRODUCTS[step.service];
  let free = !product;
  // Tournament day: the play tables charge an entry fee.
  let price = product ? priceFor(shop, step.service) : 0;
  if (step.service === 'play' && shop.eventDay === dayOf(s.time)) {
    price = rt.tournamentFee;
    free = false;
  }
  if (!free) {
    const failed = product ? !acceptsPrice(c, shop, step.service, price) : price > c.budget;
    const short = product ? !consumeIngredients(shop, product.recipe) : false;
    if (failed || short) {
      if (short) think(c, "They've run out!", 'bad', -8);
      releaseStation(c);
      // No ticket means no park; anything else is just skipped.
      if (step.service === 'svc_ticket' || !step.optional) return leaveShop(c);
      return skip(c);
    }
    charge(c, shop, price, 'services', obj);
    recordSale(shop, product ? step.service : 'tournament', price);
    if (product && product.wholesale > 0) {
      // Water, power and consumables for the cycle.
      spend(s, product.wholesale, 'utilities');
      shop.today.costs += product.wholesale;
    }
  }
  c.used.push(obj.id);
  c.state = 'using';
  c.timer = d.duration ?? product?.duration ?? (d.kind === 'seat' ? rand.range(6, 12) : step.service === 'play' ? rand.range(25, 45) : 5);
  // A long cycle is nicer sitting down.
  if (c.timer >= 15 && SHOP_TYPES[shop.type].flow === 'service') {
    const seat = shop.objects.find((o) => defOf(o).kind === 'seat' && usersOf(shop.id, o.id).length < (defOf(o).capacity ?? 1));
    const spots = seat ? tilesAround(seat) : [];
    if (seat && spots.length && setPath(c, rand.pick(spots))) {
      usersOf(shop.id, seat.id).push(c.id);
      c.seatId = seat.id;
    } else think(c, 'Nowhere to sit while I wait.', 'bad', -3);
  }
}

function finishUsing(c: Customer): void {
  const shop = shopOf(c);
  const obj = shop?.objects.find((o) => o.id === c.stationId);
  if (shop && obj) {
    const d = defOf(obj);
    c.mood = clamp(c.mood + (d.fun ?? (d.kind === 'seat' ? 3 : 0)), 0, 100);
    if ((d.fun ?? 0) >= 10 && rand.chance(0.35)) think(c, rand.pick(['That was amazing!', 'Again, again!', 'Best ride here.']), 'good', 2);
    if (d.breakChance && rand.chance((d.breakChance / (d.capacity ?? 1)) * breakMult(session.state, shop))) {
      obj.broken = true;
      toast(`${shop.name}: a ${d.name.toLowerCase()} has broken down.`, 'warn');
      bus.emit('shop:changed', shop.id);
    }
  }
  releaseStation(c);
  c.step++;
  c.state = 'browse';
  c.timer = rand.range(0.2, 0.5);
}

// ---------- Shoplifters and troublemakers ----------

const FLEE_SPEED = 1.55;
/** Minutes after which a thief who has not been caught is gone for good. */
const GETAWAY_MINUTES = 6;

/** Send a shoplifter or troublemaker to a shop. */
export function sendCrook(shop: ShopState, kind: 'steal' | 'vandal'): boolean {
  return !!spawn({ shop, kind });
}

/** Staff on the premises right now, and whether any of them is there to guard. */
function watchers(shop: ShopState): { staff: number; guard: boolean } {
  const s = session.state;
  let staff = 0;
  let guard = false;
  for (const e of s.staff) {
    if (e.shopId !== shop.id || !rt.staff.has(e.id)) continue;
    staff++;
    if (prioritiesOf(shop, e.role).includes('guard') && rt.staff.get(e.id)!.task !== 'break') guard = true;
  }
  return { staff, guard };
}

/** Walk to whatever they have come for: the most valuable shelf, or a machine to wreck. */
function goToTarget(c: Customer, shop: ShopState, kind: 'steal' | 'vandal'): void {
  const g = rt.grid;
  c.shelfId = -1;
  c.slotIndex = -1;
  if (kind === 'steal') {
    let best: { obj: PlacedObject; slot: number; value: number } | null = null;
    for (const obj of shop.objects) {
      if (defOf(obj).kind !== 'shelf') continue;
      obj.slots?.forEach((sl, i) => {
        if (!sl.product || batchQty(sl.batches) <= 0) return;
        const value = (shop.prices[sl.product] ?? 0) * rand.range(0.7, 1.3);
        if (!best || value > best.value) best = { obj, slot: i, value };
      });
    }
    const target = best as { obj: PlacedObject; slot: number; value: number } | null;
    const spot = target ? frontTiles(target.obj).find((t) => walkable(g, t.x, t.y)) : undefined;
    if (!target || !spot || !setPath(c, spot.y * g.w + spot.x)) {
      c.need = null;
      return resumeWalk(c);
    }
    c.shelfId = target.obj.id;
    c.slotIndex = target.slot;
  } else {
    const machines = shop.objects.filter((o) => defOf(o).breakChance && !o.broken && tilesAround(o).length);
    const obj = machines.length ? rand.pick(machines) : undefined;
    if (obj && setPath(c, rand.pick(tilesAround(obj)))) c.shelfId = obj.id;
  }
  c.state = 'toShelf';
  if (!c.path.length) {
    c.state = 'pick';
    c.timer = rand.range(1, 2);
  }
}

function commitCrime(c: Customer, shop: ShopState): void {
  const s = session.state;
  const { staff, guard } = watchers(shop);
  const cameras = upgradeLevel(s, shop.id, 'cameras') > 0;
  const obj = shop.objects.find((o) => o.id === c.shelfId);
  c.need = null;
  c.waited = 0;

  if (c.plan[0]?.t === 'vandal') {
    if (guard && rand.chance(0.75)) {
      news(s, `Security at ${shop.name} threw out a troublemaker before they could do any damage.`, 'good');
      think(c, 'All right, all right, I am going.', 'bad');
    } else if (obj && !obj.broken) {
      obj.broken = true;
      news(s, `A troublemaker wrecked the ${defOf(obj).name.toLowerCase()} at ${shop.name}.${guard ? '' : ' A security guard would stop this.'}`, 'warn');
      bus.emit('shop:changed', shop.id);
    } else {
      shop.dirt = clamp(shop.dirt + 18, 0, 100);
      news(s, `A troublemaker made a mess of ${shop.name}.${guard ? '' : ' A security guard would stop this.'}`, 'warn');
    }
    bus.emit('world:bubble', { x: c.x, y: c.y - 0.8, text: '!', kind: 'bad' });
    return resumeWalk(c);
  }

  const slot = obj?.slots?.[c.slotIndex];
  const product = slot?.product;
  if (!slot || !product) return resumeWalk(c);
  // Small expensive things walk out one at a time; cheap things by the armful.
  const taken = takeFromSlot(shop, slot, PRODUCTS[product].market > 10 ? rand.int(1, 2) : rand.int(2, 6));
  if (!taken) return resumeWalk(c);
  c.loot = [{ product, qty: taken, price: shop.prices[product] }];
  c.fleeFrom = shop.id;
  bus.emit('stock:changed', shop.id);
  // The more eyes on the shop floor, the likelier someone notices.
  const T = EVENTS.theft;
  const seen = T.seenBase + (guard ? T.seenGuard : 0) + (cameras ? T.seenCameras : 0) + Math.min(T.seenStaffMax, staff * T.seenPerStaff) + (s.ownerAt?.shopId === shop.id ? T.seenPerStaff : 0);
  if (rand.chance(seen)) {
    c.fleeing = true;
    c.speed *= FLEE_SPEED;
    think(c, 'They saw me. Run!', 'bad');
    bus.emit('world:bubble', { x: c.x, y: c.y - 0.8, text: 'Thief!', kind: 'bad' });
    toast(`Shoplifter spotted at ${shop.name}!${guard ? ' Security is giving chase.' : ''}`, 'warn');
  }
  resumeWalk(c);
}

const lootValue = (c: Customer): number => Math.round(c.loot.reduce((a, l) => a + l.qty * l.price, 0));
const lootText = (c: Customer): string => c.loot.map((l) => `${l.qty} ${productName(l.product)}`).join(', ');

/** A guard caught up with a fleeing thief: the goods go back to the stock room. */
export function thiefCaught(customerId: number, byStaffId: number): void {
  const s = session.state;
  const c = rt.byId.get(customerId);
  if (!c || !c.loot.length) return;
  const shop = shopById(s, c.fleeFrom);
  const guard = s.staff.find((e) => e.id === byStaffId);
  if (shop) {
    const today = dayOf(s.time);
    for (const l of c.loot) addToStorage(shop, l.product, l.qty, PRODUCTS[l.product].shelfLife ? today + 1 : 0);
    bus.emit('stock:changed', shop.id);
    news(s, `${guard?.name ?? 'Security'} caught a shoplifter at ${shop.name}. The ${lootText(c)} ${c.loot[0].qty === 1 && c.loot.length === 1 ? 'is' : 'are'} back in the stock room.`, 'good');
  }
  if (guard) guard.morale = clamp(guard.morale + 4, 0, 100);
  bus.emit('world:bubble', { x: c.x, y: c.y - 0.8, text: 'Caught!', kind: 'good' });
  c.loot = [];
  c.fleeing = false;
  c.speed /= FLEE_SPEED;
  think(c, 'Caught.', 'bad', -30);
}

/** Nobody stopped them. Cameras sometimes identify a thief afterwards. */
function gotAway(c: Customer): void {
  const s = session.state;
  const shop = shopById(s, c.fleeFrom);
  const value = lootValue(c);
  if (shop) {
    const cameras = upgradeLevel(s, shop.id, 'cameras') > 0;
    const { guard } = watchers(shop);
    if (cameras && rand.chance(EVENTS.theft.cameraRecover)) {
      earn(s, value, 'refund');
      news(s, `A shoplifter took ${lootText(c)} from ${shop.name}, but your cameras identified them and ${money(value)} was recovered.`, 'info');
    } else {
      news(s, `Shoplifter at ${shop.name}: ${lootText(c)} gone (${money(value)} of stock).${guard ? '' : cameras ? ' A security guard could have caught them.' : ' Cameras or a security guard would help.'}`, 'warn');
    }
  }
  if (c.fleeing) c.speed /= FLEE_SPEED;
  c.loot = [];
  c.fleeing = false;
}

// ---------- Vending machines ----------

const VENDING_CHANCE = 0.14;

/** Anyone walking right past a vending machine may buy something on impulse. */
function passVending(c: Customer, tile: number): void {
  const g = rt.grid;
  for (const near of [tile, tile - 1, tile + 1, tile - g.w, tile + g.w]) {
    const ref = rt.vendingAt.get(near);
    if (!ref || !rand.chance(VENDING_CHANCE)) continue;
    const s = session.state;
    const shop = shopById(s, ref.shopId);
    const obj = shop?.objects.find((o) => o.id === ref.objId);
    if (!shop || !obj || obj.broken) continue;
    const stocked = (obj.slots ?? []).filter((sl) => sl.product && batchQty(sl.batches) > 0);
    shop.today.customers++;
    if (!stocked.length) {
      if (rand.chance(0.3)) think(c, 'This vending machine is empty.', 'bad', -2);
      shop.today.walkouts++;
      return;
    }
    const slot = rand.pick(stocked);
    const price = shop.prices[slot.product!];
    // People pay a little over the odds for convenience, but not much.
    if (price > fairPrice(s, shop, slot.product!) * (1.15 + 0.2 * c.generosity) || price > c.budget) {
      shop.today.walkouts++;
      return;
    }
    takeFromSlot(shop, slot, 1);
    obj.cash = (obj.cash ?? 0) + price;
    recordSale(shop, slot.product!, price);
    c.budget -= price;
    shop.today.served++;
    shop.today.unitsSold++;
    bus.emit('world:bubble', { x: obj.x + 0.5, y: obj.y, text: `+$${price.toFixed(2)}`, kind: 'good' });
    const d = defOf(obj);
    if (d.breakChance && rand.chance(d.breakChance * breakMult(s, shop))) {
      obj.broken = true;
      toast(`${shop.name}: a vending machine has jammed.`, 'warn');
      bus.emit('shop:changed', shop.id);
    }
    return;
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
    case 'toStation':
      return startUsing(c);
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
    let budget = 3;
    while (rt.spawnDebt >= 1 && budget-- > 0 && rt.customers.length < target) {
      rt.spawnDebt--;
      spawn();
    }
    rt.spawnDebt = Math.min(rt.spawnDebt, 6);
  }

  // Refresh the crowd map a few times a game minute; paths planned after this avoid busy tiles.
  crowdClock -= dt;
  if (crowdClock <= 0) {
    crowdClock = 0.3;
    rt.crowd.fill(0);
    for (const c of rt.customers) {
      const i = Math.floor(c.y) * g.w + Math.floor(c.x);
      if (rt.crowd[i] < 255) rt.crowd[i]++;
    }
  }

  updateRegisters(dt);
  for (const r of updateKitchens(dt)) orderReady(r.customerId, r.minutes);

  for (let i = rt.customers.length - 1; i >= 0; i--) {
    const c = rt.customers[i];
    if (c.loot.length) {
      c.waited += dt;
      if (c.waited > GETAWAY_MINUTES) gotAway(c);
    }
    switch (c.state) {
      case 'browse':
      case 'pick':
      case 'waitStation':
        c.timer -= dt;
        if (c.timer <= 0) {
          if (c.state === 'pick') evaluateShelf(c);
          else nextStep(c);
        }
        continue;
      case 'using':
        c.timer -= dt;
        if (c.timer <= 0) {
          finishUsing(c);
          continue;
        }
        break;
      case 'awaitOrder':
        c.waited += dt;
        if (c.waited > c.patience * 1.6) {
          think(c, "Where's my food?! I'm leaving.", 'bad', -35);
          leaveShop(c);
          continue;
        }
        break;
      case 'queue':
        continue;
    }

    let dist = c.speed * dt;
    while (dist > 0 && c.path.length) {
      const n = c.path[c.path.length - 1];
      if (g.cost[n] === 0) {
        // Something was built in the way since the route was planned.
        if (!setPath(c, c.goal)) {
          if (c.state === 'using' || c.state === 'awaitOrder') c.path = [];
          else resumeWalk(c);
        }
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
        rt.heat[n] += 1;
        if ((c.state === 'walk' || c.state === 'leave') && rt.vendingAt.size) passVending(c, n);
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
    if (!c.path.length && rt.byId.has(c.id) && c.state !== 'using' && c.state !== 'awaitOrder') arrive(c);
  }
}
