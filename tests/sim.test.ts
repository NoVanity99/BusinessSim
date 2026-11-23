import { describe, expect, it } from 'vitest';
import { session } from '../src/core/state';
import { FURNITURE, PRODUCTS, SHOP_TYPES } from '../src/data';
import { rt } from '../src/systems/ai/runtime';
import { hire } from '../src/systems/staff/staff';
import { openShop, run, setClock, startGame, stockShelves } from './helpers';

/** Add someone to the job market and hire them for a round-the-clock shift. */
function staff(role: string, shopId: number): void {
  const s = session.state;
  s.candidates.push({ id: s.nextPersonId++, name: `Test ${role}`, role, skills: { speed: 6, friendliness: 6, reliability: 10 }, traits: [], wage: 12, look: 1 });
  hire(s, s.candidates[s.candidates.length - 1].id, shopId)!.shift = [0, 24];
}

describe('game data', () => {
  it('only refers to things that exist', () => {
    for (const [id, type] of Object.entries(SHOP_TYPES)) {
      for (const f of type.furniture) expect(FURNITURE[f], `${id} furniture ${f}`).toBeDefined();
      for (const p of [...type.products, ...type.supplies]) expect(PRODUCTS[p], `${id} product ${p}`).toBeDefined();
    }
    for (const [id, p] of Object.entries(PRODUCTS)) for (const input of Object.keys(p.recipe ?? {})) expect(PRODUCTS[input], `${id} recipe input ${input}`).toBeDefined();
    const demand = Object.values(SHOP_TYPES).reduce((a, t) => a + t.demand, 0);
    // Shares are relative: together they may pass 1, but not by so much that every business is starved.
    expect(demand).toBeLessThan(1.5);
  });
});

describe('simulation', () => {
  it('a stocked convenience store sells through a day and closes its books', () => {
    const s = startGame();
    const shop = openShop('convenience', [['shelf', 1, 1, 0], ['shelf', 3, 1, 0], ['fridge', 5, 1, 0], ['register', 1, 5, 3]], { chips: 300, candy: 300, bread: 100, noodles: 100, soda: 300, water: 300 }, 'downtown');
    stockShelves(shop, [['chips', 'candy'], ['bread', 'noodles'], ['soda', 'water']]);
    s.ownerAt = { shopId: shop.id, objectId: shop.objects[3].id };
    staff('stocker', shop.id);
    setClock(7);
    const cash = s.money;
    run(18 * 60);
    expect(shop.today.customers + shop.yesterday.customers).toBeGreaterThan(20);
    expect(shop.today.revenue + shop.yesterday.revenue).toBeGreaterThan(50);
    expect(s.finance.history.length).toBe(1);
    expect(shop.history.length).toBe(1);
    expect(s.money).not.toBe(cash);
  });

  it('every business type opens and takes money', () => {
    const s = startGame();
    const shops = {
      coffee: openShop('coffee', [['counter', 2, 2, 0], ['espresso', 1, 1, 0], ['oven', 4, 1, 0], ['table', 2, 5, 0]], { beans: 400, milkjug: 200, teabag: 100, dough: 48, croissant: 40, muffin: 40 }, 'downtown'),
      laundromat: openShop('laundromat', [['washer', 1, 1, 0], ['washer', 2, 1, 0], ['dryer', 4, 1, 0], ['dryer', 5, 1, 0], ['bench', 3, 4, 0]], {}, 'downtown'),
      fastfood: openShop('fastfood', [['counter', 2, 2, 0], ['grill', 1, 1, 0], ['fryer', 4, 1, 0], ['drinks', 5, 1, 0], ['table', 2, 5, 0]], { bun: 400, patty: 400, cheese: 200, potato: 400, chicken: 200, syrup: 400, milkmix: 100 }, 'downtown'),
      cardshop: openShop('cardshop', [['card_shelf', 1, 1, 0], ['display_case', 4, 1, 0], ['play_table', 4, 4, 0], ['register', 1, 4, 3]], { booster: 400, sleeves: 60, single_rare: 30, single_ultra: 5, single_common: 60 }, 'downtown'),
      gas: openShop('gas', [['shelf', 1, 1, 0], ['register', 1, 2, 3], ['pump', 2, 5, 0], ['pump', 5, 5, 0], ['fuel_tank', 0, 6, 0]], { fuel: 380, chips: 80 }),
      vending: openShop('vending', [['vending', 1, 8, 0], ['vending', 3, 8, 0], ['storage_rack', 1, 1, 0]], { chips: 100, soda: 100, candy: 100 }, 'downtown'),
      factory: openShop('factory', [['mixer', 1, 1, 0], ['ind_oven', 4, 1, 0], ['pallet_rack', 1, 5, 0]], { flour: 40, sugar: 40, chili: 30, vinegar: 30 }),
      funpark: openShop('funpark', [['gate', 5, 12, 0], ['slide', 1, 1, 0], ['carousel', 5, 1, 0], ['picnic', 6, 6, 0]]),
    };
    stockShelves(shops.cardshop, [['booster', 'sleeves'], ['single_common', 'single_rare', 'single_ultra']]);
    stockShelves(shops.gas, [['chips']]);
    stockShelves(shops.vending, [['chips', 'soda', 'candy'], ['chips', 'soda', 'candy']]);
    shops.factory.objects[0].recipe = 'hotsauce';
    shops.factory.objects[1].recipe = 'cookies';
    shops.factory.autoSell = true;
    shops.coffee.objects.find((o) => o.def === 'oven')!.recipe = 'croissant';
    for (const k of ['coffee', 'fastfood', 'cardshop', 'gas'] as const) staff('cashier', shops[k].id);
    staff('cook', shops.fastfood.id);
    staff('stocker', shops.factory.id);
    staff('driver', shops.vending.id);

    setClock(9);
    run(11 * 60);
    for (const [name, shop] of Object.entries(shops)) {
      const cashInMachines = shop.objects.reduce((a, o) => a + (o.cash ?? 0), 0);
      expect(shop.today.revenue + cashInMachines, `${name} revenue`).toBeGreaterThan(0);
    }
    expect(Number.isFinite(s.money)).toBe(true);
    expect(rt.cars.length).toBeGreaterThan(0);
  });
});
