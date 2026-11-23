import { bus } from '../../core/events';
import { money } from '../../core/format';
import { session, shopById } from '../../core/state';
import { selectStaff, ui } from '../../core/uiState';
import { rt } from '../../systems/ai/runtime';
import { performance } from '../../systems/staff/staff';
import { formatHour } from '../../systems/time/clock';
import { h, setChildren } from '../dom';
import { prioritiesOf, TASK_NAMES } from '../../systems/staff/agents';
import { offerLine } from './ShopPanel';
import { roleTag, skillBars, traitTags } from './staffWidgets';

/** Shown when you click an employee in the world. */
export function StaffInfoPanel(): { el: HTMLElement; destroy(): void } {
  const el = h('div.panel.npc-panel', { style: { display: 'none' } });

  const render = (): void => {
    const s = session.state;
    const e = ui.selectedStaff !== null ? s.staff.find((x) => x.id === ui.selectedStaff) : undefined;
    if (!e) {
      el.style.display = 'none';
      return;
    }
    const agent = rt.staff.get(e.id);
    const shop = e.shopId !== null ? shopById(s, e.shopId) : undefined;
    el.style.display = 'block';
    setChildren(
      el,
      h('h3', h('span', e.name), h('button.close', { onclick: () => selectStaff(null) }, '×')),
      h('div.sub', roleTag(e.role), ` at ${shop?.name ?? 'no shop'}`),
      h('div.sub', agent?.activity ?? 'Off shift'),
      shop && agent && h('div.sub.dim', { tip: 'Their jobs in order. Change the order in the shop\'s Staff tab.' }, prioritiesOf(shop, e.role).map((t, i) => `${i + 1}. ${TASK_NAMES[t] ?? t}`).join('  ')),
      h('div.person', { style: { border: '0', padding: '0', margin: '0' } }, offerLine(s, e)),
      skillBars(e),
      h('div.row', { style: { flexWrap: 'wrap', gap: '4px', margin: '6px 0' } }, ...traitTags(e)),
      h('div.kv', h('span.k', 'Energy'), h('span.v', `${Math.round(e.energy)}%`)),
      h('div.meter', h('div', { style: { width: `${e.energy}%`, background: e.energy > 40 ? 'var(--info)' : 'var(--warn)' } })),
      h('div.kv', { tip: 'Driven by fair pay, reasonable hours, a clean shop and a manager on site.' }, h('span.k', 'Morale'), h('span.v', `${Math.round(e.morale)}%`)),
      h('div.meter', h('div', { style: { width: `${e.morale}%`, background: e.morale > 40 ? 'var(--accent)' : 'var(--danger)' } })),
      h('div.kv', { tip: 'Their current work rate. 100% is an average, rested, content worker.' }, h('span.k', 'Performance'), h('span.v', `${Math.round(performance(e) * 100)}%`)),
      h('div.kv', h('span.k', 'Shift'), h('span.v', `${formatHour(e.shift[0])} to ${formatHour(e.shift[1])}`)),
      h('div.kv', h('span.k', 'Wage'), h('span.v', `${money(e.wage)} / hour`)),
      h('div.note', 'Change shifts, pay and assignments in the shop\'s Staff tab.'),
    );
  };

  const timer = window.setInterval(() => ui.selectedStaff !== null && render(), 500);
  const offs = [bus.on('staff:selected', render), bus.on('staff:changed', render)];
  return {
    el,
    destroy: () => {
      clearInterval(timer);
      offs.forEach((off) => off());
    },
  };
}
