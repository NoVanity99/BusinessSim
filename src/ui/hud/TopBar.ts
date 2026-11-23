import { SPEEDS } from '../../core/constants';
import { bus } from '../../core/events';
import { money } from '../../core/format';
import { session } from '../../core/state';
import { clockText, dateText, setSpeed } from '../../systems/time/clock';
import { h } from '../dom';
import { weatherDef } from '../../systems/world/weather';
import { SHOP_TYPES } from '../../data';
import { levelProgress } from '../../systems/progress/level';

/** Money, date/time and speed controls. Returns the element and a cleanup function. */
export function TopBar(): { el: HTMLElement; destroy(): void } {
  const s = session.state;
  const moneyEl = h('div.money', { tip: 'Cash on hand' });
  const clockEl = h('div.clock');
  const levelFill = h('div');
  const levelText = h('span');
  const levelEl = h('div.level', { tip: 'Earn experience by serving customers, making sales and opening businesses. Levels unlock new business types, upgrades and loans.' }, levelText, h('div.meter', levelFill));
  const repEl = h('div.stat', { tip: 'Average reputation across your businesses that serve customers.' });
  const dateEl = h('div.date');
  const weatherEl = h('div.weather');
  const refreshWeather = (): void => {
    const w = weatherDef(s);
    weatherEl.textContent = `${w.icon} ${w.name}`;
    weatherEl.dataset.tip = w.description;
  };

  const labels: Record<number, [string, string]> = {
    0: ['❚❚', 'Pause (Space)'],
    1: ['▶', 'Normal speed (1)'],
    2: ['▶▶', 'Double speed (2)'],
    4: ['▶▶▶', 'Quadruple speed (3)'],
  };
  const speedBtns = SPEEDS.map((sp) => h('button', { tip: labels[sp][1], onclick: () => setSpeed(s.time, sp) }, labels[sp][0]));

  const refreshMoney = (): void => {
    moneyEl.textContent = money(Math.floor(s.money));
    moneyEl.classList.toggle('negative', s.money < 0);
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
    repEl.replaceChildren(h('span.label', 'Reputation'), shops.length ? String(Math.round(shops.reduce((a, sh) => a + sh.reputation, 0) / shops.length)) : '–');
  };
  const refreshSpeed = (): void => speedBtns.forEach((b, i) => b.classList.toggle('active', SPEEDS[i] === s.time.speed));

  const offs = [bus.on('money:changed', refreshMoney), bus.on('time:minute', refreshTime), bus.on('time:speed', refreshSpeed), bus.on('xp:changed', refreshLevel), bus.on('time:hour', refreshRep), bus.on('shop:created', refreshRep)];
  refreshLevel();
  refreshRep();
  refreshWeather();
  offs.push(bus.on('weather:changed', refreshWeather));
  refreshMoney();
  refreshTime();
  refreshSpeed();

  const el = h(
    'div.topbar',
    h('div.company', { tip: 'Your company' }, s.companyName),
    moneyEl,
    levelEl,
    repEl,
    h('div.spacer'),
    weatherEl,
    dateEl,
    clockEl,
    h('div.speed', ...speedBtns),
  );
  return { el, destroy: () => offs.forEach((off) => off()) };
}
