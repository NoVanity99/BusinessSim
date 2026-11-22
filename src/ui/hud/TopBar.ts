import { SPEEDS } from '../../core/constants';
import { bus } from '../../core/events';
import { money } from '../../core/format';
import { session } from '../../core/state';
import { clockText, dateText, setSpeed } from '../../systems/time/clock';
import { h } from '../dom';

/** Money, date/time and speed controls. Returns the element and a cleanup function. */
export function TopBar(): { el: HTMLElement; destroy(): void } {
  const s = session.state;
  const moneyEl = h('div.money', { tip: 'Cash on hand' });
  const clockEl = h('div.clock');
  const dateEl = h('div.date');

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
  const refreshSpeed = (): void => speedBtns.forEach((b, i) => b.classList.toggle('active', SPEEDS[i] === s.time.speed));

  const offs = [bus.on('money:changed', refreshMoney), bus.on('time:minute', refreshTime), bus.on('time:speed', refreshSpeed)];
  refreshMoney();
  refreshTime();
  refreshSpeed();

  const el = h(
    'div.topbar',
    h('div.company', { tip: 'Your company' }, s.companyName),
    moneyEl,
    h('div.spacer'),
    dateEl,
    clockEl,
    h('div.speed', ...speedBtns),
  );
  return { el, destroy: () => offs.forEach((off) => off()) };
}
