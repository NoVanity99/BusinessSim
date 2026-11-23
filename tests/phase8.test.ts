import { describe, expect, it } from 'vitest';
import { session } from '../src/core/state';
import { ECONOMY, LOGISTICS, PRODUCTS, SHOP_TYPES } from '../src/data';
import { batchQty } from '../src/entities/Shop';
import { chooseShop } from '../src/systems/ai/residents';
import { rt } from '../src/systems/ai/runtime';
import { createShop } from '../src/systems/build/build';
import { applyTemplate, templatesFor } from '../src/systems/build/templates';
import { rentLot } from '../src/systems/economy/property';
import { addToStorage, fillObject, quoteOrder } from '../src/systems/economy/stock';
import { acceptOffer, flagship, franchisesDaily, revoke } from '../src/systems/logistics/franchise';
import { cancelContract, contractsDaily, contractUnitPrice, deliveryProblem, dispatchDeliveries, setSupplier, signContract } from '../src/systems/logistics/logistics';
import { wholesalePrice } from '../src/systems/economy/market';
import { hire } from '../src/systems/staff/staff';
import { findLot, run, setClock, startGame } from './helpers';

function staff(role: string, shopId: number): void {
  const s = session.state;
  s.candidates.push({ id: s.nextPersonId++, name: `Test ${role}`, role, skills: { speed: 7, friendliness: 6, reliability: 10 }, traits: [], wage: 12, look: 1 });
  hire(s, s.candidates[s.candidates.length - 1].id, shopId)!.shift = [0, 24];
}

function starter(type: string) {
  const s = session.state;
  const lot = findLot(type, 'downtown');
  rentLot(s, lot);
  const shop = createShop(s, lot, type)!;
  applyTemplate(s, shop, templatesFor(type).find((t) => t.builtIn)!);
  shop.hours = [0, 24];
  return shop;
}

describe('own deliveries', () => {
  it('a warehouse with a van and a driver keeps a shop stocked', () => {
    const s = startGame();
    const store = starter('convenience');
    const depot = starter('warehouse');
    for (const p of ['chips', 'candy', 'bread', 'noodles', 'soda', 'water']) addToStorage(depot, p, 200, 0);
    setSupplier(s, store, depot.id);
    expect(deliveryProblem(s, depot)).toBe('No driver hired');
    staff('driver', depot.id);
    setClock(9);
    expect(deliveryProblem(s, depot)).toBeNull();
    const before = batchQty(depot.storage.chips);
    dispatchDeliveries(s);
    expect(batchQty(depot.storage.chips)).toBeLessThan(before);
    expect(s.orders.some((o) => o.shopId === store.id && o.fromShopId === depot.id)).toBe(true);
    // One van: nothing more goes out until it is back.
    const orders = s.orders.length;
    dispatchDeliveries(s);
    expect(s.orders.length).toBe(orders);
    run(120);
    expect(batchQty(store.storage.chips) + store.objects.reduce((a, o) => a + (o.slots ?? []).reduce((b, sl) => b + (sl.product === 'chips' ? batchQty(sl.batches) : 0), 0), 0)).toBeGreaterThan(0);
    expect(rt.cars.length).toBeGreaterThan(0);
  });

  it('orders to a warehouse are cheaper', () => {
    const s = startGame();
    const store = starter('convenience');
    const depot = starter('warehouse');
    const lines = [{ product: 'chips', cases: 4 }];
    expect(quoteOrder(s, lines, false, depot).total).toBeLessThan(quoteOrder(s, lines, false, store).total);
    expect(ECONOMY.wholesale.warehouseDiscount).toBeGreaterThan(0);
  });
});

describe('supplier contracts', () => {
  it('deliver every morning at a locked price and can be ended', () => {
    const s = startGame();
    const store = starter('convenience');
    const unit = contractUnitPrice(s, 'steady', 'chips');
    expect(unit).toBeLessThan(wholesalePrice(s, 'chips'));
    expect(signContract(s, 'budget', store, 'chips', 1)).toBe(false);
    expect(signContract(s, 'steady', store, 'chips', 2)).toBe(true);
    // The market doubles; the contract price does not move.
    s.market.mult.chips = 2;
    const cash = s.money;
    s.time.minutes += 1440;
    contractsDaily(s);
    expect(batchQty(store.storage.chips)).toBe(2 * PRODUCTS.chips.caseSize);
    expect(cash - s.money).toBeCloseTo(2 * PRODUCTS.chips.caseSize * unit, 1);
    expect(cancelContract(s, s.contracts[0].id)).toBe(true);
    expect(s.contracts.length).toBe(0);
    for (let d = 0; d < LOGISTICS.suppliers.flex.days + 2; d++) { s.time.minutes += 1440; contractsDaily(s); }
  });
});

describe('production chains', () => {
  it('everything a factory can make is cheaper to make than to buy, from inputs it can order', () => {
    const s = startGame();
    const factory = SHOP_TYPES.factory;
    const stations = new Set(factory.furniture.map((f) => (f === 'mixer' ? 'mix' : f === 'ind_oven' ? 'bake' : f === 'bottler' ? 'bottle' : f === 'roaster' ? 'roast' : f === 'sewing_line' ? 'sew' : '')));
    for (const p of factory.products) {
      const d = PRODUCTS[p];
      expect(d.recipe, `${p} has a recipe`).toBeDefined();
      expect(stations.has(d.station!), `${p} station ${d.station}`).toBe(true);
      let inputs = 0;
      for (const [i, n] of Object.entries(d.recipe!)) {
        // An input is either bought in or is itself made here (hot sauce goes into mango sauce).
        expect([...factory.supplies, ...factory.products], `${p} input ${i}`).toContain(i);
        inputs += wholesalePrice(s, i) * n;
      }
      expect(inputs / (d.batch ?? 1), `${p} make cost`).toBeLessThan(wholesalePrice(s, p));
    }
  });
});

describe('franchises', () => {
  it('pay a fee and royalties, take custom, and occupy their lot', () => {
    const s = startGame();
    const store = starter('convenience');
    for (const p of ['chips', 'candy', 'bread', 'noodles', 'soda', 'water']) addToStorage(store, p, 100, 0);
    for (const o of store.objects) fillObject(store, o);
    expect(flagship(s, 'convenience')).toBeUndefined();
    store.reputation = 80;
    s.time.minutes = 8 * 1440 + 600;
    for (let d = 1; d <= 6; d++) store.history.push({ day: d, customers: 50, served: 45, walkouts: 5, revenue: 400, unitsSold: 100, costs: 200 });
    expect(flagship(s, 'convenience')?.id).toBe(store.id);
    for (let i = 0; i < 40 && !s.franchiseOffers.length; i++) franchisesDaily(s);
    expect(s.franchiseOffers.length).toBeGreaterThan(0);
    const offer = s.franchiseOffers[0];
    const lot = session.city.lots[offer.lotId];
    const cash = s.money;
    expect(acceptOffer(s, offer.id)).toBe(true);
    expect(s.money).toBe(cash + offer.fee);
    expect(rentLot(s, lot)).toBe(false);
    expect(rt.grid.cost[lot.y * session.city.w + lot.x]).toBe(0);
    setClock(12);
    let there = 0;
    for (let i = 0; i < 300; i++) if (chooseShop(s, null, 'worker', 'convenience', s.residents[i % s.residents.length].home).rival?.id === s.franchises[0].id) there++;
    expect(there).toBeGreaterThan(10);
    const before = s.money;
    s.franchises[0].today = 60;
    s.time.minutes += 1440;
    franchisesDaily(s);
    expect(s.money).toBeGreaterThan(before);
    revoke(s, s.franchises[0]);
    expect(rentLot(s, lot)).toBe(true);
  });
});
