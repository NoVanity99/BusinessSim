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
import { loansDaily } from './economy/loans';
import { netWorth } from './economy/networth';
import { eventsDaily, eventsHourly, initEvents } from './events/events';
import { installProgress } from './progress/level';
import { DIFFICULTIES, EVENTS } from '../data';
import { rt } from './ai/runtime';

/**
 * Wires the clock to everything that happens on a schedule.
 * Returns a function that removes the listeners.
 */
export function installSim(): () => void {
  const s = session.state;
  if (!s.candidates.length) refreshCandidates(s, 0);
  initEvents(s);

  const offs = [
    installProgress(s),
    bus.on('time:minute', () => processDeliveries(s)),
    bus.on('time:hour', () => {
      staffHourly(s);
      managerReorder(s);
      eventsHourly(s);
      // Footfall fades so the overlay shows recent traffic, not all of history.
      for (let i = 0; i < rt.heat.length; i++) rt.heat[i] *= 0.82;
      checkEndings();
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
      loansDaily(s);
      const closed = closeDay(s, day);
      for (const shop of s.shops) {
        shop.yesterday = shop.today;
        shop.today = emptyStats();
      }
      driftMarket(s);
      expireStock(s);
      staffDaily(s);
      eventsDaily(s);
      const income = Object.values(closed.income).reduce((a, b) => a + (b ?? 0), 0);
      const expense = Object.values(closed.expense).reduce((a, b) => a + (b ?? 0), 0);
      if (rent + utilities > 0 || income > 0) {
        toast(`Day ${day - 1} closed: ${money(Math.round(income))} in, ${money(Math.round(expense))} out. Rent ${money(rent)}, utilities ${money(utilities)}.`, income >= expense ? 'good' : 'warn');
      }
    }),
  ];
  /** Winning is a milestone, not the end; bankruptcy is the end. */
  function checkEndings(): void {
    if (!s.won && netWorth(s, session.city) >= DIFFICULTIES[s.difficulty].netWorthGoal) {
      s.won = true;
      bus.emit('game:won');
    }
    if (!s.bankrupt && s.money <= EVENTS.bankruptcyCash) {
      s.bankrupt = true;
      bus.emit('game:over');
    }
  }

  return () => offs.forEach((off) => off());
}
