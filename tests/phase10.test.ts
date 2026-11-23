import { describe, expect, it } from 'vitest';
import { createNewGame, session } from '../src/core/state';
import { FURNITURE, PRODUCTS, SHOP_TYPES } from '../src/data';
import { batchQty } from '../src/entities/Shop';
import { createShop } from '../src/systems/build/build';
import { applyTemplate, templatesFor } from '../src/systems/build/templates';
import { generateCity } from '../src/systems/city/generate';
import { setInsurance } from '../src/systems/economy/corporate';
import { rentLot } from '../src/systems/economy/property';
import { addToStorage, fillObject } from '../src/systems/economy/stock';
import { shopDemandMult } from '../src/systems/events/events';
import { randomDaily, trendBoost, triggerEvent } from '../src/systems/events/random';
import { acceptJob, checkScenario, deliverJob, goalProgress, jobsDaily, SCENARIOS } from '../src/systems/progress/scenarios';
import { isOpenNow } from '../src/systems/shop/status';
import { hire } from '../src/systems/staff/staff';
import { bootSimulation, findLot, run, setClock, startGame } from './helpers';

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
  for (const p of [...SHOP_TYPES[type].products, ...SHOP_TYPES[type].supplies]) if (!['menu', 'service'].includes(PRODUCTS[p].kind ?? 'good')) addToStorage(shop, p, PRODUCTS[p].storage === 'vehicle' ? 1 : 150, 0);
  for (const o of shop.objects) fillObject(shop, o);
  shop.hours = [0, 24];
  return shop;
}

describe('the last six businesses', () => {
  it('have furniture, products and stations that exist', () => {
    for (const type of ['gym', 'bar', 'cinema', 'hotel', 'cardealer', 'foodtruck']) {
      const t = SHOP_TYPES[type];
      expect(t, type).toBeDefined();
      for (const f of t.furniture) expect(FURNITURE[f], `${type} ${f}`).toBeDefined();
      for (const p of t.products) {
        expect(PRODUCTS[p], `${type} ${p}`).toBeDefined();
        const d = PRODUCTS[p];
        if (d.kind === 'menu') expect(t.furniture.some((f) => FURNITURE[f].station === d.station), `${type} can make ${p}`).toBe(true);
        if (d.kind === 'service') expect(t.furniture.some((f) => FURNITURE[f].service === p), `${type} offers ${p}`).toBe(true);
      }
    }
  });

  it('gym, bar, cinema and hotel take money from a starter layout', () => {
    const s = startGame();
    const shops = ['gym', 'bar', 'cinema', 'hotel'].map((type) => {
      const shop = starter(type);
      staff('cashier', shop.id);
      if (SHOP_TYPES[type].flow === 'counter') staff('cook', shop.id);
      return shop;
    });
    s.ownerAt = null;
    setClock(10);
    run(16 * 60);
    for (const shop of shops) expect(shop.today.revenue + shop.yesterday.revenue, `${shop.type} revenue`).toBeGreaterThan(0);
  });

  it('a car dealership sells whole cars to customers who can pay for them', () => {
    const s = startGame();
    const shop = starter('cardealer');
    staff('cashier', shop.id);
    s.ownerAt = null;
    // Trade is thin by design; give it a few days.
    setClock(9);
    for (let day = 0; day < 6 && shop.history.reduce((a, d) => a + d.revenue, shop.today.revenue) === 0; day++) {
      run(1440);
      for (const o of shop.objects) if (o.slots && batchQty(o.slots[0].batches) === 0) { addToStorage(shop, o.slots[0].product!, 1, 0); fillObject(shop, o); }
    }
    const takings = shop.history.reduce((a, d) => a + d.revenue, shop.today.revenue);
    expect(takings).toBeGreaterThan(5000);
  });
});

describe('random events', () => {
  it('a fire closes a shop for a while and insurance pays', () => {
    const s = startGame();
    const shop = starter('convenience');
    setInsurance(s, 'disaster', true);
    setClock(10);
    expect(isOpenNow(s, shop)).toBe(true);
    const cash = s.money;
    triggerEvent(s, 'fire');
    expect(isOpenNow(s, shop)).toBe(false);
    expect(s.money).toBeGreaterThanOrEqual(cash);
    s.time.minutes += 13 * 60;
    expect(isOpenNow(s, shop)).toBe(true);
  });

  it('roadworks, trends and floods do what they say', () => {
    const s = startGame();
    const shop = starter('convenience');
    triggerEvent(s, 'roadworks');
    expect(shopDemandMult(s, shop)).toBeLessThan(1);
    triggerEvent(s, 'trend');
    const product = s.events.find((e) => e.type === 'trend')!.product!;
    expect(trendBoost(s, product)).toBeGreaterThan(1);
    addToStorage(shop, 'chips', 100, 0);
    const before = batchQty(shop.storage.chips);
    triggerEvent(s, 'flood');
    expect(batchQty(shop.storage.chips)).toBeLessThan(before);
    expect(shop.dirt).toBeGreaterThan(50);
    // A long run of days never throws, whatever comes up.
    for (let d = 0; d < 120; d++) { s.time.minutes += 1440; randomDaily(s); }
    expect(Number.isFinite(s.money)).toBe(true);
  });
});

describe('delivery orders', () => {
  it('are offered, accepted, delivered from the back rooms and paid', () => {
    const s = startGame();
    const shop = starter('convenience');
    s.time.minutes = 3 * 1440 + 600;
    for (let i = 0; i < 30 && !s.jobs.length; i++) jobsDaily(s);
    expect(s.jobs.length).toBeGreaterThan(0);
    const job = s.jobs[0];
    acceptJob(s, job.id);
    // Nothing in the back rooms yet: it cannot be delivered.
    for (const sh of s.shops) delete sh.storage[job.product];
    expect(deliverJob(s, job.id)).toBe(false);
    shop.storageBonus = 5000;
    addToStorage(shop, job.product, job.qty + 300, 0);
    const cash = s.money;
    expect(deliverJob(s, job.id)).toBe(true);
    expect(s.money).toBe(cash + job.reward);
    expect(s.jobs.find((j) => j.id === job.id)).toBeUndefined();
  });

  it('charge a penalty when an accepted order is missed', () => {
    const s = startGame();
    starter('convenience');
    s.jobs.push({ id: 99, client: 'Test', product: 'chips', qty: 9999, reward: 1000, deadlineDay: 1, accepted: true });
    s.time.minutes = 3 * 1440;
    const cash = s.money;
    jobsDaily(s);
    expect(s.money).toBeLessThan(cash);
  });
});

describe('scenarios and sandbox', () => {
  it('every scenario starts as described and can be won or lost', () => {
    for (const def of SCENARIOS) {
      session.state = createNewGame({ companyName: 'T', difficulty: 'normal', mode: 'scenario', scenarioId: def.id });
      session.city = generateCity();
      bootSimulation();
      const s = session.state;
      expect(s.money).toBe(def.money);
      expect(s.level).toBe(def.level);
      expect(s.scenario?.deadlineDay).toBe(def.days);
      if (def.loan) expect(s.loans[0].balance).toBe(def.loan);
      expect(goalProgress(s, def.goals).length).toBeGreaterThan(0);
      checkScenario(s);
      expect(s.scenario?.result).toBeUndefined();
      s.time.minutes = (def.days + 1) * 1440;
      checkScenario(s);
      expect(s.scenario?.result).toBe('lost');
    }
    session.state = createNewGame({ companyName: 'T', difficulty: 'normal', mode: 'scenario', scenarioId: 'corner' });
    bootSimulation();
    session.state.money = 50000;
    checkScenario(session.state);
    expect(session.state.scenario?.result).toBe('won');
  });

  it('the sandbox has everything unlocked and cannot go bankrupt', () => {
    session.state = createNewGame({ companyName: 'T', difficulty: 'normal', mode: 'sandbox' });
    session.city = generateCity();
    bootSimulation();
    const s = session.state;
    expect(s.level).toBe(12);
    expect(s.rules?.noBankruptcy).toBe(true);
    s.money = -999999;
    run(120);
    expect(s.bankrupt).toBe(false);
  });
});
