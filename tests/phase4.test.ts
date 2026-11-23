import { describe, expect, it } from 'vitest';
import { session } from '../src/core/state';
import { batchQty } from '../src/entities/Shop';
import { sendCrook } from '../src/systems/ai/customers';
import { chooseShop } from '../src/systems/ai/residents';
import { rt } from '../src/systems/ai/runtime';
import { rentLot } from '../src/systems/economy/property';
import { allRivalShops, buyOut, matchOffer, rivalsDaily } from '../src/systems/rivals/rivals';
import { migrateState } from '../src/systems/save/migrations';
import { movePriority, prioritiesOf } from '../src/systems/staff/agents';
import { hire } from '../src/systems/staff/staff';
import { openShop, run, setClock, startGame, stockShelves } from './helpers';

function staff(role: string, shopId: number, speed = 6): number {
  const s = session.state;
  s.candidates.push({ id: s.nextPersonId++, name: `Test ${role}`, role, skills: { speed, friendliness: 6, reliability: 10 }, traits: [], wage: 12, look: 1 });
  const e = hire(s, s.candidates[s.candidates.length - 1].id, shopId)!;
  e.shift = [0, 24];
  return e.id;
}

function store(): ReturnType<typeof openShop> {
  const shop = openShop('convenience', [['shelf', 1, 1, 0], ['shelf', 3, 1, 0], ['fridge', 5, 1, 0], ['register', 1, 5, 3]], { chips: 300, candy: 300, bread: 100, noodles: 100, soda: 300, water: 300 }, 'downtown');
  stockShelves(shop, [['chips', 'candy'], ['bread', 'noodles'], ['soda', 'water']]);
  shop.hours = [0, 24];
  return shop;
}

describe('staff task priorities', () => {
  it('a lone cashier serves, and restocks and cleans when it is quiet', () => {
    startGame();
    const shop = store();
    const id = staff('cashier', shop.id);
    session.state.ownerAt = null;
    // Empty a shelf section and dirty the floor: both are lower on a cashier's list than serving.
    const slot = shop.objects[0].slots![0];
    slot.batches = [];
    shop.dirt = 60;
    // The small hours: hardly anyone about, so the lower-priority jobs get done.
    setClock(3);
    const seen = new Set<string>();
    const watch = (minutes: number): void => {
      for (let i = 0; i < minutes; i++) {
        run(1);
        seen.add(rt.staff.get(id)?.task ?? '');
      }
    };
    watch(120);
    expect(seen.has('restock')).toBe(true);
    expect(seen.has('clean')).toBe(true);
    expect(batchQty(slot.batches)).toBeGreaterThan(0);
    expect(shop.dirt).toBeLessThan(60);
    // Midday: customers come first.
    setClock(12);
    watch(180);
    expect(seen.has('serve')).toBe(true);
    expect(shop.today.served).toBeGreaterThan(3);
  });

  it('lets the player reorder a role and keeps unknown tasks out', () => {
    startGame();
    const shop = store();
    expect(prioritiesOf(shop, 'cashier')).toEqual(['serve', 'restock', 'clean']);
    movePriority(shop, 'cashier', 'clean', -1);
    expect(prioritiesOf(shop, 'cashier')).toEqual(['serve', 'clean', 'restock']);
    shop.priorities!.cashier = ['juggle', 'clean'];
    expect(prioritiesOf(shop, 'cashier')).toEqual(['clean', 'serve', 'restock']);
  });
});

describe('shoplifters', () => {
  const stockOnShelves = (shop: ReturnType<typeof openShop>): number => shop.objects.reduce((a, o) => a + (o.slots ?? []).reduce((b, sl) => b + batchQty(sl.batches), 0), 0);
  const total = (shop: ReturnType<typeof openShop>): number => stockOnShelves(shop) + Object.values(shop.storage).reduce((a, b) => a + batchQty(b), 0);

  it('walk in, take stock from a shelf and get away when nobody is watching', () => {
    const s = startGame();
    const shop = store();
    // Keep ordinary shoppers out so the only stock movement is the theft.
    shop.closed = false;
    rt.customers.length = 0;
    rt.byId.clear();
    setClock(3);
    const before = total(shop);
    let sent = 0;
    for (let i = 0; i < 6; i++) if (sendCrook(shop, 'steal')) sent++;
    expect(sent).toBeGreaterThan(0);
    run(90);
    expect(total(shop)).toBeLessThan(before);
    expect(s.news.some((n) => /Shoplifter at/.test(n.text))).toBe(true);
  });

  it('are chased and caught by a fast guard', () => {
    const s = startGame();
    const shop = store();
    staff('security', shop.id, 10);
    setClock(3);
    run(20);
    for (let round = 0; round < 6; round++) {
      for (let i = 0; i < 4; i++) sendCrook(shop, 'steal');
      run(60);
    }
    expect(s.news.some((n) => /caught a shoplifter/.test(n.text))).toBe(true);
  });
});

describe('rival companies', () => {
  it('open shops, take custom, block their lots, and can be bought out', () => {
    const s = startGame();
    const shop = store();
    expect(s.rivals.length).toBeGreaterThan(1);
    shop.yesterday.revenue = 900;
    for (let day = 0; day < 80 && allRivalShops(s).length < 3; day++) {
      s.time.minutes += 1440;
      // Stand in for the residents who would have walked in over the day.
      for (const r of allRivalShops(s)) r.today = 90;
      rivalsDaily(s);
    }
    const rivals = allRivalShops(s);
    expect(rivals.length).toBeGreaterThanOrEqual(3);
    const lot = session.city.lots[rivals[0].lotId];
    expect(rentLot(s, lot)).toBe(false);
    expect(rt.grid.cost[lot.y * session.city.w + lot.x]).toBe(0);

    // With rivals selling the same thing, some shoppers choose them.
    const type = rivals[0].type;
    setClock(12);
    let toRival = 0;
    for (let i = 0; i < 400; i++) if (chooseShop(s, null, 'worker', type, s.residents[i % s.residents.length].home).rival) toRival++;
    expect(toRival).toBeGreaterThan(20);

    const count = rivals.length;
    expect(buyOut(s, rivals[0])).toBe(true);
    expect(allRivalShops(s).length).toBe(count - 1);
    expect(rt.grid.cost[lot.y * session.city.w + lot.x]).toBeGreaterThan(0);
    expect(rentLot(s, lot)).toBe(true);
  });

  it('poach staff unless the offer is matched', () => {
    const s = startGame();
    const shop = store();
    const stay = staff('cashier', shop.id, 9);
    const go = staff('stocker', shop.id, 9);
    s.offers.push({ staffId: stay, companyId: 1, wage: 20, day: Math.floor(s.time.minutes / 1440) + 2 }, { staffId: go, companyId: 1, wage: 20, day: Math.floor(s.time.minutes / 1440) + 2 });
    matchOffer(s, stay);
    expect(s.staff.find((e) => e.id === stay)!.wage).toBe(20);
    s.time.minutes += 1440;
    rivalsDaily(s);
    expect(s.staff.some((e) => e.id === stay)).toBe(true);
    expect(s.staff.some((e) => e.id === go)).toBe(false);
  });

  it('replace the old rival event when an older save is migrated', () => {
    const old = { version: 4, shops: [], events: [{ type: 'rival', untilDay: 9, shopId: 1, label: 'x' }, { type: 'holiday', untilDay: 9, label: 'y' }] } as Record<string, unknown>;
    migrateState(old, 4);
    expect(old.rivals).toEqual([]);
    expect(old.offers).toEqual([]);
    expect((old.events as { type: string }[]).map((e) => e.type)).toEqual(['holiday']);
  });
});
