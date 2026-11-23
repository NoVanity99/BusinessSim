import { bus } from '../../core/events';
import { session } from '../../core/state';
import { goalProgress, scenarioOf } from '../../systems/progress/scenarios';
import { dayOf } from '../../systems/time/clock';
import { h, setChildren } from '../dom';

/** Shows a scenario's goals, how far along each is, and the days left. Hidden outside scenarios. */
export function Tracker(): { el: HTMLElement; destroy(): void } {
  const s = session.state;
  const el = h('div.panel.tracker', { style: { display: 'none' } });
  let folded = false;
  const render = (): void => {
    const def = scenarioOf(s);
    if (!def || !s.scenario) return;
    el.style.display = 'block';
    const left = s.scenario.deadlineDay - dayOf(s.time) + 1;
    const goals = goalProgress(s, def.goals);
    setChildren(
      el,
      h('h3', { onclick: () => { folded = !folded; render(); }, style: { cursor: 'pointer' }, tip: 'Click to fold' }, h('span', def.name), h('span', { class: s.scenario.result === 'won' ? 'good' : left <= 3 ? 'warn' : 'dim', style: { fontSize: '12.5px', fontWeight: '400' } }, s.scenario.result === 'won' ? 'Completed' : s.scenario.result === 'lost' ? 'Out of time' : `${left} day${left === 1 ? '' : 's'} left`)),
      ...(folded ? [] : goals.map((g) => h('div.step', { class: g.done ? 'done' : 'now' }, h('span.mark', g.done ? '✓' : '·'), g.label, h('span.dim', `  ${g.value}`)))),
    );
  };
  render();
  const timer = window.setInterval(render, 2000);
  const off = bus.on('scenario:ended', render);
  return {
    el,
    destroy: () => {
      clearInterval(timer);
      off();
    },
  };
}
