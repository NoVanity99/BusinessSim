import { describe, expect, it } from 'vitest';
import { session } from '../src/core/state';
import { CORPORATE } from '../src/data';
import { rt } from '../src/systems/ai/runtime';
import { createShop } from '../src/systems/build/build';
import { applyTemplate, templatesFor } from '../src/systems/build/templates';
import { acceptInvestor, buyBack, claim, corporateDaily, premiumPerDay, propertyDaily, setInsurance, taxableProfit, taxForecast, totalStake } from '../src/systems/economy/corporate';
import { earn, spend } from '../src/systems/economy/finance';
import { netWorth } from '../src/systems/economy/networth';
import { buyLot, evictTenant, letLot, priceOf, releaseLot, rentLot, saleValue } from '../src/systems/economy/property';
import { migrateState } from '../src/systems/save/migrations';
import { buyCar, moveHome, playerHourly, visitProblem, visitShop, visitsLeft } from '../src/systems/player/player';
import { operatorSpeed } from '../src/systems/shop/status';
import { registers } from '../src/entities/Shop';
import { findLot, startGame } from './helpers';

function store() {
  const s = session.state;
  const lot = findLot('convenience', 'downtown');
  rentLot(s, lot);
  const shop = createShop(s, lot, 'convenience')!;
  applyTemplate(s, shop, templatesFor('convenience').find((t) => t.builtIn)!);
  return shop;
}

describe('property', () => {
  it('prices follow a district index that stays within bounds', () => {
    const s = startGame();
    const lot = findLot('convenience');
    const before = priceOf(s, lot);
    s.propertyIndex[lot.district] = 1.5;
    expect(priceOf(s, lot)).toBeCloseTo(before * 1.5, -3);
    for (let i = 0; i < 400; i++) propertyDaily(s);
    for (const v of Object.values(s.propertyIndex)) {
      expect(v).toBeGreaterThanOrEqual(CORPORATE.property.minIndex);
      expect(v).toBeLessThanOrEqual(CORPORATE.property.maxIndex);
    }
    expect(s.propertyHistory.length).toBeLessThanOrEqual(60);
  });

  it('an owned lot can be let, which blocks it, pays rent, and must be ended before selling', () => {
    const s = startGame();
    const lot = findLot('convenience');
    expect(buyLot(s, lot)).toBe(true);
    const worth = netWorth(s, session.city);
    expect(letLot(s, lot)).toBe(true);
    expect(rt.grid.cost[lot.y * session.city.w + lot.x]).toBe(0);
    expect(createShop(s, lot, 'convenience')).toBeNull();
    expect(releaseLot(s, lot)).toBe(false);
    const cash = s.money;
    s.time.minutes += 1440;
    corporateDaily(s, { day: 1, income: {}, expense: {} });
    expect(s.money).toBeGreaterThan(cash);
    expect(evictTenant(s, lot)).toBe(true);
    expect(rt.grid.cost[lot.y * session.city.w + lot.x]).toBeGreaterThan(0);
    // Buying and selling at once loses only the agent's fee.
    expect(Math.abs(netWorth(s, session.city) - worth)).toBeLessThan(priceOf(s, lot) * 0.1);
    expect(saleValue(s, lot)).toBeLessThan(priceOf(s, lot));
    expect(releaseLot(s, lot)).toBe(true);
  });
});

describe('tax, investors and insurance', () => {
  it('taxes trading profit but not loans or property deals', () => {
    expect(taxableProfit([{ day: 1, income: { sales: 1000, loan: 5000, propertySale: 9000 }, expense: { wages: 300, property: 8000, tax: 50 } }])).toBe(700);
    const s = startGame();
    earn(s, 2000, 'sales');
    spend(s, 500, 'wages');
    expect(taxForecast(s).profitTax).toBeCloseTo(1500 * CORPORATE.tax.profitRate);
    // The bill lands when the seventh day closes.
    const cash = s.money;
    s.finance.history.push({ day: 7, income: { sales: 2000 }, expense: { wages: 500 } });
    s.time.minutes = 7 * 1440 + 60;
    corporateDaily(s, s.finance.history[s.finance.history.length - 1]);
    expect(cash - s.money).toBeGreaterThanOrEqual(Math.round(1500 * CORPORATE.tax.profitRate));
  });

  it('investors pay in, take their share of profit, and can be bought out', () => {
    const s = startGame();
    s.investorOffers.push({ id: 1, name: 'Test Backer', stake: 0.2, amount: 10000, untilDay: 99 });
    const cash = s.money;
    expect(acceptInvestor(s, 1)).toBe(true);
    expect(s.money).toBe(cash + 10000);
    expect(totalStake(s)).toBeCloseTo(0.2);
    const before = s.money;
    s.time.minutes = 2 * 1440 + 60;
    corporateDaily(s, { day: 2, income: { sales: 1000 }, expense: {} });
    expect(before - s.money).toBeCloseTo(200, 0);
    expect(buyBack(s, s.investors[0])).toBe(true);
    expect(s.investors.length).toBe(0);
  });

  it('insurance costs a premium per shop and pays out on claims', () => {
    const s = startGame();
    store();
    expect(claim(s, 'theft', 100)).toBe(0);
    setInsurance(s, 'theft', true);
    const cash = s.money;
    expect(claim(s, 'theft', 100)).toBe(80);
    expect(s.money).toBe(cash + 80);
    s.time.minutes += 1440;
    corporateDaily(s, { day: 1, income: {}, expense: {} });
    expect(s.finance.today.expense.insurance).toBe(premiumPerDay(s, 'theft'));
  });
});

describe('the owner', () => {
  it('tires at the till, slows down, and is sent home when exhausted', () => {
    const s = startGame();
    const shop = store();
    const till = registers(shop)[0];
    s.ownerAt = { shopId: shop.id, objectId: till.id };
    expect(operatorSpeed(s, shop, till)).toBe(1);
    for (let i = 0; i < 16; i++) playerHourly(s);
    expect(s.player.energy).toBeLessThan(CORPORATE.player.tiredBelow);
    expect(operatorSpeed(s, shop, till)).toBe(CORPORATE.player.tiredSpeed);
    for (let i = 0; i < 10; i++) playerHourly(s);
    expect(s.ownerAt).toBeNull();
    for (let i = 0; i < 30; i++) playerHourly(s);
    expect(s.player.energy).toBe(CORPORATE.player.homes.studio.maxEnergy);
  });

  it('a better home and a car change what a day allows', () => {
    const s = startGame();
    const shop = store();
    expect(visitsLeft(s)).toBe(CORPORATE.player.cars.none.visitsPerDay);
    expect(visitShop(s, shop)).toBe(true);
    expect(visitProblem(s, shop)).toMatch(/already/);
    expect(buyCar(s, 'sedan')).toBe(true);
    expect(visitsLeft(s)).toBe(CORPORATE.player.cars.sedan.visitsPerDay - 1);
    expect(moveHome(s, 'house')).toBe(true);
    s.ownerAt = null;
    for (let i = 0; i < 20; i++) playerHourly(s);
    expect(s.player.energy).toBe(CORPORATE.player.homes.house.maxEnergy);
  });

  it('is added to older saves', () => {
    const old = { version: 8, shops: [], events: [] } as Record<string, unknown>;
    migrateState(old, 8);
    expect((old.player as { home: string }).home).toBe('studio');
    expect(old.insurance).toEqual({});
  });
});
