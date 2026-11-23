import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { session } from '../src/core/state';
import { EVENTS, PRODUCTS, SHOP_TYPES } from '../src/data';
import { batchQty, type ShopState } from '../src/entities/Shop';
import { createShop } from '../src/systems/build/build';
import { applyTemplate, templatesFor } from '../src/systems/build/templates';
import { rentLot } from '../src/systems/economy/property';
import { addToStorage, fillObject } from '../src/systems/economy/stock';
import { hire } from '../src/systems/staff/staff';
import { findLot, run, setClock, startGame } from './helpers';

/**
 * Not a test: a report. Opens each kind of business on its own from its starter layout,
 * staffs and stocks it, runs three days and prints what it earned against what it cost.
 * Run with `npm run balance`. Used to tune prices, demand and costs.
 */
const on = process.env.BALANCE === '1';

/** Cover the opening hours with one person per role, or two half-shifts when the day is long. */
function staff(role: string, shopId: number): void {
  const s = session.state;
  const shop = s.shops.find((x) => x.id === shopId)!;
  const [from, to] = shop.hours;
  const length = to > from ? to - from : 24 - from + to;
  const shifts: [number, number][] = length > 10 ? [[from, (from + Math.ceil(length / 2)) % 24 || 24], [(from + Math.ceil(length / 2)) % 24, to]] : [[from, to]];
  for (const shift of shifts) {
    s.candidates.push({ id: s.nextPersonId++, name: `Test ${role}`, role, skills: { speed: 6, friendliness: 6, reliability: 10 }, traits: [], wage: 11, look: 1 });
    hire(s, s.candidates[s.candidates.length - 1].id, shopId)!.shift = shift;
  }
}

const stockValue = (shop: ShopState): number => {
  let v = 0;
  // Base prices, so day-to-day market drift does not look like stock appearing or vanishing.
  for (const [p, b] of Object.entries(shop.storage)) v += batchQty(b) * PRODUCTS[p].wholesale;
  for (const o of shop.objects) for (const sl of o.slots ?? []) if (sl.product) v += batchQty(sl.batches) * PRODUCTS[sl.product].wholesale;
  return v;
};

describe.skipIf(!on)('balance report', () => {
  it('prints takings, costs and payback for every business', () => {
    const rows: string[] = [];
    // Fires and floods are not what is being measured.
    EVENTS.random.minDay = 9999;
    const DAYS = 3;
    const RUNS = Number(process.env.BALANCE_RUNS ?? 2);
    for (const [type, T] of Object.entries(SHOP_TYPES)) {
      if (T.demand <= 0 || !templatesFor(type).some((t) => t.builtIn)) continue;
      const acc = { invested: 0, income: 0, cogs: 0, wages: 0, rent: 0, util: 0, cust: 0, served: 0, walk: 0, rep: 0 };
      for (let r = 0; r < RUNS; r++) {
        const s = startGame(2_000_000);
        const before = s.money;
        const lot = findLot(type, 'downtown');
        rentLot(s, lot);
        const shop = createShop(s, lot, type)!;
        applyTemplate(s, shop, templatesFor(type).find((t) => t.builtIn)!);
        acc.invested += before - s.money;
        for (const p of [...T.products, ...T.supplies]) if (!['menu', 'service'].includes(PRODUCTS[p].kind ?? 'good')) addToStorage(shop, p, PRODUCTS[p].storage === 'vehicle' ? 2 : 600, 0);
        shop.storageBonus = 100000;
        for (const o of shop.objects) fillObject(shop, o);
        // The leanest team that can run it: someone to serve where there is a till, and a cook where food is made to order.
        if (T.roles.includes('cashier')) staff('cashier', shop.id);
        if (T.flow === 'counter') staff('cook', shop.id);
        s.ownerAt = null;
        const stock0 = stockValue(shop);
        setClock(5);
        // Day by day, with a repair round each morning as an attentive owner would do.
        for (let d = 0; d < DAYS; d++) {
          run(1440);
          for (const o of shop.objects) o.broken = false;
        }
        run(60);
        const days = s.finance.history.slice(0, DAYS);
        const hist = shop.history.slice(0, DAYS);
        acc.income += days.reduce((a, d) => a + (d.income.sales ?? 0) + (d.income.services ?? 0), 0) / DAYS;
        acc.wages += days.reduce((a, d) => a + (d.expense.wages ?? 0), 0) / DAYS;
        acc.rent += days.reduce((a, d) => a + (d.expense.rent ?? 0), 0) / DAYS;
        acc.util += days.reduce((a, d) => a + (d.expense.utilities ?? 0), 0) / DAYS;
        acc.cogs += (stock0 - stockValue(shop)) / DAYS;
        acc.cust += hist.reduce((a, d) => a + d.customers, 0) / DAYS;
        acc.served += hist.reduce((a, d) => a + d.served, 0) / DAYS;
        acc.walk += hist.reduce((a, d) => a + d.walkouts, 0) / DAYS;
        acc.rep += shop.reputation;
      }
      for (const k of Object.keys(acc) as (keyof typeof acc)[]) acc[k] /= RUNS;
      const profit = acc.income - acc.wages - acc.rent - acc.util - acc.cogs;
      rows.push([type.padEnd(12), `L${T.unlockLevel}`.padEnd(4), `inv ${Math.round(acc.invested)}`.padEnd(10), `in ${Math.round(acc.income)}`.padEnd(9), `cogs ${Math.round(acc.cogs)}`.padEnd(10), `wage ${Math.round(acc.wages)}`.padEnd(9), `rent ${Math.round(acc.rent)}`.padEnd(9), `util ${Math.round(acc.util)}`.padEnd(8), `PROFIT ${Math.round(profit)}`.padEnd(13), `payback ${profit > 0 ? (acc.invested / profit).toFixed(1) : '∞'}d`.padEnd(14), `cust ${Math.round(acc.served)}/${Math.round(acc.cust)}`.padEnd(13), `walk ${Math.round(acc.walk)}`.padEnd(8), `rep ${Math.round(acc.rep)}`].join(' '));
    }
    // The test runner hides console output from passing tests, so the table goes to a file as well.
    writeFileSync(process.env.BALANCE_OUT ?? 'balance-report.txt', rows.join('\n') + '\n');
    console.log('\n' + rows.join('\n') + '\n');
  }, 900_000);
});
