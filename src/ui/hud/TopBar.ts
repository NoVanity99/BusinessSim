import { SPEEDS } from '../../core/constants';
import { dayOfSeason, holidaysOn, nextHoliday, seasonOf } from '../../systems/world/seasons';
import { SEASONS } from '../../data';
import { dayOf } from '../../systems/time/clock';
import { bus } from '../../core/events';
import { money } from '../../core/format';
import { session } from '../../core/state';
import { clockText, dateText, setSpeed } from '../../systems/time/clock';
import { h } from '../dom';
import { weatherDef } from '../../systems/world/weather';
import { SHOP_TYPES } from '../../data';
import { levelProgress } from '../../systems/progress/level';
import { icon, WEATHER_ICON } from '../icons';
import { notes } from '../notify';

/** How long the money counter takes to roll to a new value, in milliseconds. */
const ROLL_MS = 450;

/** Money, level, reputation, weather, date, speed and the notification bell. */
export function TopBar(openNotifications: () => void): { el: HTMLElement; destroy(): void } {
  const s = session.state;
  const moneyText = h('span');
  const deltas = h('div.deltas');
  const moneyEl = h('div.money', { tip: 'Cash on hand' }, icon('coin', 18), moneyText, deltas);
  const clockEl = h('div.clock');
  const levelFill = h('div');
  const levelText = h('span');
  const levelEl = h('div.level', { tip: 'Earn experience by serving customers, making sales and opening businesses. Levels unlock new business types, upgrades and loans.' }, icon('star', 16), levelText, h('div.meter', levelFill));
  const repEl = h('div.stat', { tip: 'Average reputation across your businesses that serve customers.' });
  const dateEl = h('div.date');
  const weatherEl = h('div.weather');
  const seasonEl = h('div.season');
  const refreshWeather = (): void => {
    const w = weatherDef(s);
    weatherEl.replaceChildren(icon(WEATHER_ICON[s.weather.kind] ?? 'sun', 18), h('span', w.name));
    weatherEl.dataset.tip = w.description;
  };
  const refreshSeason = (): void => {
    const season = seasonOf(s);
    const today = holidaysOn(dayOf(s.time));
    const next = nextHoliday(s);
    seasonEl.replaceChildren(icon(season.icon, 18), h('span', today.length ? today[0].name : season.name));
    seasonEl.classList.toggle('holiday', today.length > 0);
    seasonEl.dataset.tip = `${season.name}, day ${dayOfSeason(s)} of ${SEASONS.daysPerSeason}. ${season.description}${today.length ? `\n\nToday: ${today.map((x) => `${x.name}. ${x.description}`).join(' ')}` : ''}${next ? `\n\nNext: ${next.holiday.name} in ${next.inDays} day${next.inDays === 1 ? '' : 's'}.` : ''}`;
  };

  const badge = h('span.badge');
  const bell = h('button.bell', { tip: 'Notifications (N)\nEverything that has happened; click an entry to go there.', onclick: openNotifications }, icon('bell', 18), badge);
  const refreshBell = (): void => {
    badge.textContent = notes.unread > 99 ? '99+' : String(notes.unread);
    badge.style.display = notes.unread ? 'flex' : 'none';
    bell.classList.toggle('ringing', notes.list.some((n) => !n.read && (n.kind === 'bad' || n.kind === 'warn')));
  };

  const speedIcon: Record<number, [string, string]> = {
    0: ['pause', 'Pause (Space)'],
    1: ['play', 'Normal speed (1)'],
    2: ['fast', 'Double speed (2)'],
    4: ['faster', 'Quadruple speed (3)'],
  };
  const speedBtns = SPEEDS.map((sp) => h('button', { tip: speedIcon[sp][1], onclick: () => setSpeed(s.time, sp) }, icon(speedIcon[sp][0], 16)));

  // The counter rolls toward the real balance instead of jumping, and each change floats past as +/-.
  let shown = s.money;
  let from = s.money;
  let target = s.money;
  let started = 0;
  let raf = 0;
  let pending = 0;
  let flushTimer = 0;
  const paint = (): void => {
    moneyText.textContent = money(Math.floor(shown));
    moneyEl.classList.toggle('negative', shown < 0);
  };
  const tick = (now: number): void => {
    const t = Math.min(1, (now - started) / ROLL_MS);
    shown = from + (target - from) * (1 - Math.pow(1 - t, 3));
    paint();
    raf = t < 1 ? requestAnimationFrame(tick) : 0;
  };
  const flush = (): void => {
    flushTimer = 0;
    if (Math.abs(pending) < 1) return;
    const chip = h(`span.delta.${pending >= 0 ? 'up' : 'down'}`, `${pending >= 0 ? '+' : '−'}${money(Math.abs(Math.round(pending)))}`);
    deltas.append(chip);
    while (deltas.children.length > 3) deltas.firstElementChild?.remove();
    setTimeout(() => chip.remove(), 1500);
    pending = 0;
  };
  const refreshMoney = (): void => {
    if (s.money === target) return;
    pending += s.money - target;
    // Small sales arrive in bursts: show one combined figure every so often.
    if (!flushTimer) flushTimer = window.setTimeout(flush, 600);
    from = shown;
    target = s.money;
    started = performance.now();
    if (!raf) raf = requestAnimationFrame(tick);
  };

  const refreshTime = (): void => {
    clockEl.textContent = clockText(s.time);
    dateEl.textContent = dateText(s.time);
  };
  const refreshLevel = (): void => {
    levelText.textContent = `Level ${s.level}`;
    levelFill.style.width = `${Math.round(levelProgress(s) * 100)}%`;
  };
  const refreshRep = (): void => {
    const shops = s.shops.filter((sh) => SHOP_TYPES[sh.type].demand > 0 || SHOP_TYPES[sh.type].carDemand);
    repEl.replaceChildren(icon('smile', 16), h('span.label', 'Reputation'), shops.length ? String(Math.round(shops.reduce((a, sh) => a + sh.reputation, 0) / shops.length)) : '–');
  };
  const refreshSpeed = (): void => speedBtns.forEach((b, i) => b.classList.toggle('active', SPEEDS[i] === s.time.speed));

  const offs = [
    bus.on('money:changed', refreshMoney),
    bus.on('time:minute', refreshTime),
    bus.on('time:speed', refreshSpeed),
    bus.on('xp:changed', refreshLevel),
    bus.on('time:hour', refreshRep),
    bus.on('shop:created', refreshRep),
    bus.on('weather:changed', refreshWeather),
    bus.on('time:day', refreshSeason),
    bus.on('notes:changed', refreshBell),
  ];
  refreshLevel();
  refreshRep();
  refreshWeather();
  refreshSeason();
  paint();
  refreshTime();
  refreshSpeed();
  refreshBell();

  const el = h('div.topbar', h('div.company', { tip: 'Your company' }, s.companyName), moneyEl, levelEl, repEl, h('div.spacer'), seasonEl, weatherEl, h('div.when', dateEl, clockEl), h('div.speed', ...speedBtns), bell);
  return {
    el,
    destroy: () => {
      offs.forEach((off) => off());
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(flushTimer);
    },
  };
}
