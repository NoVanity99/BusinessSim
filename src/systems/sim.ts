import { bus, toast } from '../core/events';
import { money } from '../core/format';
import { session } from '../core/state';
import { emptyStats, SHOP_HISTORY_DAYS } from '../entities/Shop';
import { initAi, onShopLayoutChanged, sendCrook, thiefCaught, updateAi } from './ai/customers';
import { ensureRivals, rivalsDaily } from './rivals/rivals';
import { rebuildLot } from './ai/grid';
import { onCrook } from './events/events';
import { clearHistory } from './build/history';
import { installAchievements } from './progress/achievements';
import { marketingDaily } from './marketing/marketing';
import { contractsDaily, dispatchDeliveries, resetLogistics } from './logistics/logistics';
import { franchisesDaily } from './logistics/franchise';
import { corporateDaily } from './economy/corporate';
import { playerDaily, playerHourly } from './player/player';
import { sendDeliveryVan } from './ai/vehicles';
import { initVehicles, syncVending, updateVehicles } from './ai/vehicles';
import { updateProduction } from './shop/production';
import { updateStaff } from './staff/agents';
import { advanceClock } from './time/clock';
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
import { weatherHourly } from './world/weather';
import { DIFFICULTIES, EVENTS } from '../data';
import { rt } from './ai/runtime';

/**
 * Advance the whole simulation by `realSeconds` of wall-clock time at the current game speed.
 * The city scene calls this every frame; the tests call it in a loop with no renderer.
 * Returns the game minutes that passed.
 */
export function stepSimulation(realSeconds: number): number {
  const s = session.state;
  const gameMinutes = advanceClock(s.time, realSeconds);
  updateProduction(s, gameMinutes);
  updateStaff(gameMinutes);
  updateAi(gameMinutes);
  updateVehicles(gameMinutes);
  return gameMinutes;
}

/**
 * Starts the simulation around `session.state`: populates the streets, then wires the
 * clock and shop changes to everything that reacts to them.
 * Returns a function that removes the listeners.
 */
export function installSim(): () => void {
  const s = session.state;
  if (!s.candidates.length) refreshCandidates(s, 0);
  ensureRivals(s);
  // Undo history belongs to the session that made it.
  clearHistory();
  resetLogistics();
  onCrook((shop, kind) => sendCrook(shop, kind));
  initAi();
  initVehicles();
  // Remembers where each shop stood so its tiles can be freed when it is removed.
  const shopLots = new Map(s.shops.map((sh) => [sh.id, sh.lotId]));
  initEvents(s);

  const offs = [
    installProgress(s),
    installAchievements(s),
    // Any change to a shop's walls or furniture changes where people can walk and queue.
    bus.on('shop:changed', (id) => {
      const lotId = s.shops.find((sh) => sh.id === id)?.lotId;
      if (lotId === undefined) return;
      shopLots.set(id, lotId);
      onShopLayoutChanged(id, lotId);
      syncVending();
    }),
    bus.on('shop:removed', (id) => {
      const lotId = shopLots.get(id);
      if (lotId !== undefined) onShopLayoutChanged(id, lotId);
      shopLots.delete(id);
      syncVending();
    }),
    bus.on('time:minute', (minute) => {
      processDeliveries(s);
      // Vans are sent out every twenty minutes if anything is running short.
      if (minute % 20 === 0) dispatchDeliveries(s);
    }),
    bus.on('delivery:sent', ({ fromShopId, toShopId }) => sendDeliveryVan(fromShopId, toShopId)),
    bus.on('thief:caught', ({ customerId, by }) => thiefCaught(customerId, by)),
    // A rival moving in or out changes where people can walk.
    bus.on('lot:changed', (lotId) => rebuildLot(rt.grid, session.city, session.city.lots[lotId])),
    bus.on('time:hour', () => {
      staffHourly(s);
      playerHourly(s);
      managerReorder(s);
      eventsHourly(s);
      weatherHourly(s);
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
      corporateDaily(s, closed);
      playerDaily(s);
      for (const shop of s.shops) {
        shop.yesterday = shop.today;
        shop.history.push({ day: day - 1, ...shop.today });
        if (shop.history.length > SHOP_HISTORY_DAYS) shop.history.shift();
        shop.today = emptyStats();
      }
      driftMarket(s);
      expireStock(s);
      staffDaily(s);
      eventsDaily(s);
      rivalsDaily(s);
      marketingDaily(s);
      contractsDaily(s);
      franchisesDaily(s);
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
