import { describe, expect, it } from 'vitest';
import { session } from '../src/core/state';
import { FURNITURE, MARKETING, PRODUCTS, SEASONS, SHOP_TYPES } from '../src/data';
import { priceIndex } from '../src/systems/ai/residents';
import { applyTemplate, templatesFor } from '../src/systems/build/templates';
import { createShop } from '../src/systems/build/build';
import { rentLot } from '../src/systems/economy/property';
import { addToStorage, fillObject } from '../src/systems/economy/stock';
import { shopDemandMult } from '../src/systems/events/events';
import { adDemand, couponCut, marketingDaily, startCampaign } from '../src/systems/marketing/marketing';
import { hire } from '../src/systems/staff/staff';
import { calendarDemand, holidaysOn, seasonOnDay, YEAR_DAYS } from '../src/systems/world/seasons';
import { rollWeather } from '../src/systems/world/weather';
import { findLot, run, setClock, startGame } from './helpers';

function staff(role: string, shopId: number): void {
  const s = session.state;
  s.candidates.push({ id: s.nextPersonId++, name: `Test ${role}`, role, skills: { speed: 7, friendliness: 6, reliability: 10 }, traits: [], wage: 12, look: 1 });
  hire(s, s.candidates[s.candidates.length - 1].id, shopId)!.shift = [0, 24];
}

/** Open a shop from its starter layout with every product and ingredient in the back room. */
function starter(type: string) {
  const s = session.state;
  const lot = findLot(type, 'downtown');
  rentLot(s, lot);
  const shop = createShop(s, lot, type)!;
  applyTemplate(s, shop, templatesFor(type).find((t) => t.builtIn)!);
  for (const p of [...SHOP_TYPES[type].products, ...SHOP_TYPES[type].supplies]) if (!['menu', 'service'].includes(PRODUCTS[p].kind ?? 'good')) addToStorage(shop, p, 200, 0);
  for (const o of shop.objects) fillObject(shop, o);
  shop.hours = [0, 24];
  return shop;
}

describe('seasons and holidays', () => {
  it('cycle through four seasons a year and change demand and weather', () => {
    expect(YEAR_DAYS).toBe(28);
    expect([1, 8, 15, 22, 29].map((d) => seasonOnDay(d).id)).toEqual(['spring', 'summer', 'autumn', 'winter', 'spring']);
    const s = startGame();
    s.time.minutes = 22 * 1440 + 600;
    expect(calendarDemand(s, 'funpark')).toBeLessThan(0.6);
    expect(calendarDemand(s, 'drugstore')).toBeGreaterThan(1.2);
    // It never snows in summer and there are no heatwaves in winter.
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) { rollWeather(s); seen.add(s.weather.kind); }
    expect(seen.has('snow')).toBe(true);
    expect(seen.has('heat')).toBe(false);
    s.time.minutes = 9 * 1440 + 600;
    seen.clear();
    for (let i = 0; i < 300; i++) { rollWeather(s); seen.add(s.weather.kind); }
    expect(seen.has('snow')).toBe(false);
  });

  it('have holidays on fixed days that refer to real shop types', () => {
    expect(holidaysOn(26)[0].name).toBe('Winter Holidays');
    expect(holidaysOn(26 + 28)[0].name).toBe('Winter Holidays');
    for (const season of SEASONS.seasons) {
      for (const type of Object.keys(season.demand)) expect(SHOP_TYPES[type], `${season.id} demand ${type}`).toBeDefined();
      for (const p of Object.keys(season.products)) expect(PRODUCTS[p], `${season.id} product ${p}`).toBeDefined();
    }
    for (let d = 1; d <= 28; d++) for (const h of holidaysOn(d)) for (const type of Object.keys(h.demand)) expect(SHOP_TYPES[type], `${h.name} ${type}`).toBeDefined();
  });
});

describe('marketing', () => {
  it('lifts interest while it runs, costs money, and ends on time', () => {
    const s = startGame();
    const shop = starter('convenience');
    const cash = s.money;
    expect(shopDemandMult(s, shop)).toBe(1);
    expect(startCampaign(s, 'flyers', shop)).toBe(true);
    expect(startCampaign(s, 'flyers', shop)).toBe(false);
    expect(s.money).toBeLessThan(cash);
    expect(adDemand(s, shop)).toBeCloseTo(MARKETING.campaigns.flyers.demand);
    expect(s.residents.some((r) => (r.memory[shop.id]?.score ?? 0) > 0)).toBe(true);
    s.time.minutes += MARKETING.campaigns.flyers.days * 1440;
    marketingDaily(s);
    expect(s.campaigns.length).toBe(0);
    expect(adDemand(s, shop)).toBe(1);
  });

  it('coupons make the shop cheaper in customers\' eyes', () => {
    const s = startGame();
    const shop = starter('convenience');
    const before = priceIndex(s, shop);
    startCampaign(s, 'coupons', shop);
    expect(couponCut(s, shop)).toBeCloseTo(0.1);
    expect(priceIndex(s, shop)).toBeCloseTo(before * 0.9);
  });
});

describe('new business types', () => {
  it('have art, products and furniture that exist', () => {
    for (const type of ['drugstore', 'bookstore', 'clothing', 'pizza', 'petshop', 'arcade', 'electronics']) {
      const t = SHOP_TYPES[type];
      expect(t, type).toBeDefined();
      for (const f of t.furniture) expect(FURNITURE[f], `${type} ${f}`).toBeDefined();
      for (const p of t.products) if (PRODUCTS[p].recipe && ['menu', 'service'].includes(PRODUCTS[p].kind ?? 'good')) for (const input of Object.keys(PRODUCTS[p].recipe!)) expect(t.supplies, `${type} supplies ${input}`).toContain(input);
    }
  });

  it('each open from the starter layout and take money in a day', () => {
    const s = startGame();
    const shops = ['drugstore', 'bookstore', 'clothing', 'pizza', 'petshop', 'arcade', 'electronics'].map((type) => {
      const shop = starter(type);
      staff('cashier', shop.id);
      if (SHOP_TYPES[type].flow === 'counter') staff('cook', shop.id);
      return shop;
    });
    s.ownerAt = null;
    setClock(9);
    run(12 * 60);
    for (const shop of shops) expect(shop.today.revenue, `${shop.type} revenue`).toBeGreaterThan(0);
  });
});
