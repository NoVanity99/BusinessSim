import { bus, toast } from '../core/events';
import { money } from '../core/format';
import { session } from '../core/state';
import { emptyStats } from '../entities/Shop';
import { closeDay, spend } from './economy/finance';
import { driftMarket } from './economy/market';
import { chargeDailyRent, rentOf } from './economy/property';
import { expireStock, processDeliveries } from './economy/stock';
import { utilityCost } from './shop/status';
import { managerReorder } from './staff/manager';
import { refreshCandidates, staffDaily, staffHourly } from './staff/staff';

/**
 * Wires the clock to everything that happens on a schedule.
 * Returns a function that removes the listeners.
 */
export function installSim(): () => void {
  const s = session.state;
  if (!s.candidates.length) refreshCandidates(s, 0);

  const offs = [
    bus.on('time:minute', () => processDeliveries(s)),
    bus.on('time:hour', () => {
      staffHourly(s);
      managerReorder(s);
    }),
    bus.on('time:day', (day) => {
      const rent = chargeDailyRent(s, session.city);
      let utilities = 0;
      for (const shop of s.shops) {
        const u = utilityCost(s, shop);
        utilities += u;
        shop.today.costs += u + (s.lots[shop.lotId]?.owner === 'rented' ? rentOf(s, session.city.lots[shop.lotId]) : 0);
      }
      spend(s, utilities, 'utilities');
      const closed = closeDay(s, day);
      for (const shop of s.shops) {
        shop.yesterday = shop.today;
        shop.today = emptyStats();
      }
      driftMarket(s);
      expireStock(s);
      staffDaily(s);
      const income = Object.values(closed.income).reduce((a, b) => a + (b ?? 0), 0);
      const expense = Object.values(closed.expense).reduce((a, b) => a + (b ?? 0), 0);
      if (rent + utilities > 0 || income > 0) {
        toast(`Day ${day - 1} closed: ${money(Math.round(income))} in, ${money(Math.round(expense))} out. Rent ${money(rent)}, utilities ${money(utilities)}.`, income >= expense ? 'good' : 'warn');
      }
    }),
  ];
  return () => offs.forEach((off) => off());
}
