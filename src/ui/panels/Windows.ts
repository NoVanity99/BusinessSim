import { bus } from '../../core/events';
import { money } from '../../core/format';
import { session, shopById } from '../../core/state';
import { selectLot, selectStaff } from '../../core/uiState';
import { DIFFICULTIES, EMPLOYEES, NEIGHBORHOODS, SHOP_TYPES } from '../../data';
import { rt } from '../../systems/ai/runtime';
import { sum, type DayLedger } from '../../systems/economy/finance';
import { netWorth, netWorthParts } from '../../systems/economy/networth';
import { dailyWageBill, onDuty, staffOf } from '../../systems/staff/staff';
import { DAY_NAMES } from '../../systems/time/clock';
import { lineChart, SERIES_COLORS } from '../charts';
import { h, setChildren } from '../dom';
import { roleTag } from './staffWidgets';

export type WindowId = 'businesses' | 'finances' | 'staff';

const LABELS: Record<string, string> = {
  sales: 'Sales', services: 'Services', wholesale: 'Wholesale', propertySale: 'Property sales', loan: 'Loans taken', refund: 'Refunds', other: 'Other',
  rent: 'Rent', wages: 'Wages', utilities: 'Utilities', stock: 'Stock', construction: 'Construction', property: 'Property', deposit: 'Deposits',
  loanPayment: 'Loan repayments', interest: 'Interest', fines: 'Fines', maintenance: 'Maintenance', marketing: 'Marketing', licenses: 'Licences',
};

const dayLabel = (day: number): string => `${DAY_NAMES[(day - 1) % 7]} ${day}`;

// ---------- Businesses ----------

function businesses(focus: (lotId: number) => void): HTMLElement {
  const s = session.state;
  const rows = s.shops.map((shop) => {
    const lot = session.city.lots[shop.lotId];
    const y = shop.yesterday;
    const profit = y.revenue - y.costs;
    const staff = staffOf(s, shop.id);
    return h(
      'tr.clickable',
      { onclick: () => focus(shop.lotId), tip: 'Go to this business' },
      h('td', h('span.dot', { style: { background: SHOP_TYPES[shop.type].color } }), shop.name),
      h('td', NEIGHBORHOODS[lot.district].name),
      h('td', { class: shop.reputation < 35 ? 'bad' : shop.reputation > 65 ? 'good' : '' }, Math.round(shop.reputation)),
      h('td', money(Math.round(shop.today.revenue))),
      h('td', `${shop.today.served}/${shop.today.customers}`),
      h('td', { class: profit < 0 ? 'bad' : '' }, money(Math.round(profit))),
      h('td', `${staff.filter((e) => onDuty(s, e)).length}/${staff.length}`),
    );
  });
  return h(
    'div.scroll',
    s.shops.length === 0
      ? h('div.note', { style: { marginTop: '0' } }, 'You have no businesses yet. Rent a lot with a yellow outline and open one.')
      : h('table.grid', h('tr', h('th', 'Business'), h('th', 'Area'), h('th', { tip: 'Reputation, 0 to 100' }, 'Rep'), h('th', 'Today'), h('th', { tip: 'Customers served of those who came in today' }, 'Served'), h('th', { tip: 'Yesterday: revenue minus stock orders, wages, rent and utilities' }, 'Profit (yest.)'), h('th', { tip: 'On shift now / total' }, 'Staff')), ...rows),
  );
}

// ---------- Finances ----------

function ledgerTable(title: string, ledgers: DayLedger[]): HTMLElement {
  const income: Record<string, number> = {};
  const expense: Record<string, number> = {};
  for (const l of ledgers) {
    for (const [k, v] of Object.entries(l.income)) income[k] = (income[k] ?? 0) + (v ?? 0);
    for (const [k, v] of Object.entries(l.expense)) expense[k] = (expense[k] ?? 0) + (v ?? 0);
  }
  const totalIn = sum(income);
  const totalOut = sum(expense);
  const line = (k: string, v: number, sign: string): HTMLElement => h('div.kv', h('span.k', LABELS[k] ?? k), h('span.v', `${sign}${money(Math.round(v))}`));
  return h(
    'div',
    { style: { flex: '1', minWidth: '0' } },
    h('div.section', title),
    ...Object.entries(income).sort((a, b) => b[1] - a[1]).map(([k, v]) => line(k, v, '+')),
    ...Object.entries(expense).sort((a, b) => b[1] - a[1]).map(([k, v]) => line(k, v, '−')),
    totalIn + totalOut === 0 && h('div.dim', { style: { fontSize: '13px' } }, 'Nothing yet.'),
    h('div.kv.totals', h('span.k', h('b', 'Net')), h('span.v', { class: totalIn - totalOut < 0 ? 'bad' : 'good' }, h('b', money(Math.round(totalIn - totalOut))))),
  );
}

function finances(): HTMLElement {
  const s = session.state;
  const parts = netWorthParts(s, session.city);
  const worth = netWorth(s, session.city);
  const goal = DIFFICULTIES[s.difficulty].netWorthGoal;
  const days = [...s.finance.history, s.finance.today].slice(-28);
  const lastWeek = s.finance.history.slice(-7);
  const chart = lineChart(
    days.map((d) => dayLabel(d.day)),
    [
      { name: 'Income', color: SERIES_COLORS.income, values: days.map((d) => Math.round(sum(d.income))) },
      { name: 'Expenses', color: SERIES_COLORS.expense, values: days.map((d) => Math.round(sum(d.expense))) },
    ],
    (n) => money(Math.round(n)),
    560,
    190,
  );
  return h(
    'div.scroll',
    h(
      'div.bigstats',
      h('div', h('div.label', 'Cash'), h('div.value', { class: s.money < 0 ? 'bad' : '' }, money(Math.round(s.money)))),
      h('div', { tip: `Cash ${money(Math.round(parts.cash))}\nProperty ${money(Math.round(parts.property))}\nEquipment ${money(Math.round(parts.equipment))}\nStock ${money(Math.round(parts.stock))}\nDeposits ${money(Math.round(parts.deposits))}\nDebt −${money(Math.round(parts.debt))}` }, h('div.label', 'Net worth'), h('div.value', money(Math.round(worth)))),
      h('div', { tip: 'Reach this net worth to win.' }, h('div.label', `Goal ${money(goal)}`), h('div.meter', { style: { marginTop: '10px' } }, h('div', { style: { width: `${Math.max(0, Math.min(100, (worth / goal) * 100))}%`, background: 'var(--accent)' } }))),
    ),
    h('div.section', `Income and expenses per day, last ${days.length} day${days.length === 1 ? '' : 's'}`),
    chart,
    h('div.row', { style: { alignItems: 'flex-start', gap: '18px', marginTop: '6px' } }, ledgerTable(`Today (${dayLabel(s.finance.today.day)})`, [s.finance.today]), ledgerTable('Yesterday', s.finance.history.slice(-1)), ledgerTable('Last 7 days', lastWeek)),
  );
}

// ---------- Staff ----------

function staff(focus: (lotId: number) => void): HTMLElement {
  const s = session.state;
  const rows = s.staff.map((e) => {
    const shop = e.shopId !== null ? shopById(s, e.shopId) : undefined;
    return h(
      'tr.clickable',
      { onclick: () => { if (shop) focus(shop.lotId); selectStaff(e.id); } },
      h('td', e.name),
      h('td', roleTag(e.role)),
      h('td', shop?.name ?? ''),
      h('td', `${e.shift[0]}–${e.shift[1]}`),
      h('td', { class: e.energy < 30 ? 'warn' : '' }, `${Math.round(e.energy)}%`),
      h('td', { class: e.morale < 30 ? 'bad' : '' }, `${Math.round(e.morale)}%`),
      h('td', money(Math.round(dailyWageBill(e)))),
      h('td', { class: 'dim' }, rt.staff.get(e.id)?.activity ?? 'Off shift'),
    );
  });
  const total = s.staff.reduce((a, e) => a + dailyWageBill(e), 0);
  return h(
    'div.scroll',
    s.staff.length === 0
      ? h('div.note', { style: { marginTop: '0' } }, `Nobody works for you yet. Hire from the Staff tab of a business. ${Object.keys(EMPLOYEES.roles).length} roles exist; each business lists the ones it can use.`)
      : h('table.grid', h('tr', h('th', 'Name'), h('th', 'Role'), h('th', 'Business'), h('th', 'Shift'), h('th', 'Energy'), h('th', 'Morale'), h('th', 'Per day'), h('th', 'Now')), ...rows),
    s.staff.length > 0 && h('div.kv.totals', h('span.k', 'Total wage bill'), h('span.v', `${money(Math.round(total))} / day`)),
  );
}

// ---------- Host ----------

const TITLES: Record<WindowId, string> = { businesses: 'Businesses', finances: 'Finances', staff: 'Staff' };

/** The sidebar and the floating window it opens. `focus` moves the camera to a lot. */
export function Sidebar(focus: (lotId: number) => void, openMenu: () => void): { el: HTMLElement; destroy(): void; toggle(id: WindowId): void } {
  let open: WindowId | null = null;
  const win = h('div.panel.float-window', { style: { display: 'none' } });
  const buttons: Record<WindowId, HTMLButtonElement> = {
    businesses: h('button', { tip: 'Businesses (B)\nEvery shop you own', onclick: () => toggle('businesses') }, '🏪'),
    finances: h('button', { tip: 'Finances (F)\nIncome, expenses and net worth', onclick: () => toggle('finances') }, '📈'),
    staff: h('button', { tip: 'Staff (T)\nEveryone on your payroll', onclick: () => toggle('staff') }, '👥'),
  };

  const jump = (lotId: number): void => {
    focus(lotId);
    selectLot(lotId);
  };

  const render = (): void => {
    for (const id of Object.keys(buttons) as WindowId[]) buttons[id].classList.toggle('active', id === open);
    if (!open) {
      win.style.display = 'none';
      return;
    }
    if (win.querySelector(':active')) return;
    win.style.display = 'flex';
    win.classList.toggle('narrow', false);
    const body = open === 'businesses' ? businesses(jump) : open === 'finances' ? finances() : staff(jump);
    setChildren(win, h('h3', h('span', TITLES[open]), h('button.close', { onclick: () => toggle(open!) }, '×')), body);
  };

  function toggle(id: WindowId): void {
    open = open === id ? null : id;
    render();
  }

  // Live numbers without rebuilding on every sale: refresh twice a second while open.
  const timer = window.setInterval(() => open && open !== 'finances' && render(), 500);
  const offs = [bus.on('time:hour', () => open === 'finances' && render()), bus.on('lot:selected', (id) => { if (id !== null && open) { open = null; render(); } })];
  const el = h('div', h('div.sidebar', buttons.businesses, buttons.finances, buttons.staff, h('button', { tip: 'Menu (Esc)\nSave, load, settings', onclick: openMenu }, '☰')), win);
  el.style.pointerEvents = 'none';
  for (const child of Array.from(el.children) as HTMLElement[]) child.style.pointerEvents = 'auto';
  return {
    el,
    toggle,
    destroy: () => {
      clearInterval(timer);
      offs.forEach((off) => off());
    },
  };
}
