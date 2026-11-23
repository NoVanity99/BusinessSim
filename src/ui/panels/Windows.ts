import { bus } from '../../core/events';
import { financeExtras, propertyWindow, youWindow } from './Corporate';
import { acceptOffer, declineOffer, flagship, franchisable, impression, inspect, royaltyOf } from '../../systems/logistics/franchise';
import { LOGISTICS, NEIGHBORHOODS } from '../../data';
import { ACHIEVEMENTS, STAT_LABELS, statValue } from '../../systems/progress/achievements';
import { staffScreen, stockScreen } from './Screens';
import { icon } from '../icons';
import { markAllRead, notificationsWindow } from '../notify';
import { dash, empireOverview, shopDashboard } from './Dashboards';
import { companyValue } from '../../systems/rivals/rivals';
import { money } from '../../core/format';
import { session } from '../../core/state';
import { selectLot, setOverlay, ui, type Overlay } from '../../core/uiState';
import { EVENTS } from '../../data';
import { canTakeLoan, dailyLoanCost, loanRate, repayLoan, takeLoan } from '../../systems/economy/loans';
import { levelProgress } from '../../systems/progress/level';
import { buyUpgrade, COMPANY, upgradeCost, upgradeLevel, upgradesFor } from '../../systems/progress/upgrades';
import { DIFFICULTIES, SHOP_TYPES } from '../../data';
import { sum, type DayLedger } from '../../systems/economy/finance';
import { netWorth, netWorthParts } from '../../systems/economy/networth';
import { DAY_NAMES } from '../../systems/time/clock';
import { lineChart, SERIES_COLORS } from '../charts';
import { h, setChildren } from '../dom';

export type WindowId = 'businesses' | 'dashboard' | 'stock' | 'finances' | 'property' | 'staff' | 'company' | 'you' | 'news';

const LABELS: Record<string, string> = {
  sales: 'Sales', royalties: 'Franchise fees and royalties', services: 'Services', wholesale: 'Wholesale', propertySale: 'Property sales', loan: 'Loans taken', refund: 'Refunds', other: 'Other',
  rent: 'Rent', wages: 'Wages', utilities: 'Utilities', stock: 'Stock', construction: 'Construction', property: 'Property', deposit: 'Deposits',
  rentIncome: 'Rent from tenants', investment: 'Investors', insurance: 'Insurance', tax: 'Tax', dividends: 'Investors\' share', buyback: 'Share buy-backs', living: 'Cost of living',
  loanPayment: 'Loan repayments', interest: 'Interest', fines: 'Fines', maintenance: 'Maintenance', marketing: 'Marketing', licenses: 'Licences',
};

const dayLabel = (day: number): string => `${DAY_NAMES[(day - 1) % 7]} ${day}`;

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

function finances(rerender: () => void): HTMLElement {
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
    ...financeExtras(s, rerender),
  );
}

// ---------- Company ----------

function company(jumpTo: (lotId: number) => void): HTMLElement {
  const s = session.state;
  const worth = netWorth(s, session.city);
  const goal = DIFFICULTIES[s.difficulty].netWorthGoal;
  const next = Object.values(SHOP_TYPES).filter((t) => t.unlockLevel > s.level).sort((a, b) => a.unlockLevel - b.unlockLevel);
  return h(
    'div.scroll',
    h(
      'div.bigstats',
      h('div', h('div.label', 'Level'), h('div.value', `${s.level}`), h('div.meter', h('div', { style: { width: `${Math.round(levelProgress(s) * 100)}%`, background: 'var(--warn)' } }))),
      h('div', h('div.label', 'Net worth'), h('div.value', money(Math.round(worth)))),
      h('div', h('div.label', `Goal ${money(goal)}`), h('div.value', s.won ? 'Reached!' : `${Math.max(0, Math.round((worth / goal) * 100))}%`)),
    ),
    next.length > 0 && h('div.note', { style: { marginTop: '0' } }, `Coming up: ${next.map((t) => `${t.name} (level ${t.unlockLevel})`).join(', ')}.`),
    ...s.franchiseOffers.map((o) => {
      const lot = session.city.lots[o.lotId];
      return h(
        'div.offer-card',
        h('div', h('b', `${o.applicant}`), ` wants to open a ${SHOP_TYPES[o.type].name.toLowerCase()} under your brand in ${NEIGHBORHOODS[lot.district].name}.`),
        h('div.dim', `${impression(o.quality)}. Pays ${money(o.fee)} now and ${Math.round(LOGISTICS.franchise.royalty * 100)}% of takings every day. How they run it reflects on your own shops.`),
        h('div.row', h('button', { onclick: () => jumpTo(o.lotId), tip: 'Show the lot they have in mind' }, 'Show lot'), h('button', { onclick: () => declineOffer(s, o.id) }, 'Decline'), h('button.primary', { onclick: () => acceptOffer(s, o.id) }, `Accept (${money(o.fee)})`)),
      );
    }),
    (s.franchises.length > 0 || s.shops.some((sh) => franchisable(sh.type))) && h('div.section', { tip: 'Once a shop of yours has a reputation of 65 or more and has been profitable for a few days, people apply to open their own under its name.' }, `Franchises (${s.franchises.length})`),
    s.franchises.length === 0 && s.shops.some((sh) => franchisable(sh.type)) && h('div.dim', { style: { fontSize: '13px' } }, s.shops.some((sh) => flagship(s, sh.type)) ? 'Your brand is strong enough to franchise. Applications will arrive.' : `Get a shop to a reputation of ${LOGISTICS.franchise.minReputation} and keep it profitable, and people will apply to open franchises.`),
    s.franchises.length > 0 &&
      h(
        'table.grid',
        h('tr', h('th', 'Franchise'), h('th', { tip: 'How well it is run. Poor ones hurt the reputation of your own shops of that kind.' }, 'Standards'), h('th', 'Royalty/day'), h('th', '')),
        ...s.franchises.map((f) =>
          h(
            'tr.clickable',
            { onclick: () => jumpTo(f.lotId) },
            h('td', f.name),
            h('td', { class: f.quality < 38 ? 'bad' : f.quality > 72 ? 'good' : '' }, f.quality < 38 ? 'Poor' : f.quality > 72 ? 'Excellent' : 'Acceptable'),
            h('td', money(Math.round(royaltyOf(f)))),
            h('td', h('button', { disabled: s.money < LOGISTICS.franchise.inspectionCost, onclick: (ev: Event) => { ev.stopPropagation(); inspect(s, f); }, tip: 'Send someone from head office to raise standards.' }, `Inspect (${money(LOGISTICS.franchise.inspectionCost)})`)),
          ),
        ),
      ),
    h('div.section', 'Rival companies'),
    h(
      'table.grid',
      h('tr', h('th', 'Company'), h('th', 'Shops'), h('th', 'Worth'), h('th', 'Style')),
      h('tr', h('td', h('span.tag', { style: { background: 'var(--accent)' } }, s.companyName)), h('td', `${s.shops.length}`), h('td', money(Math.round(worth))), h('td', { class: 'dim' }, 'You')),
      ...s.rivals.map((c) =>
        h(
          'tr',
          h('td', h('span.tag', { style: { background: c.color, color: '#fff' } }, c.name)),
          h('td', { tip: c.shops.map((sh) => sh.name).join('\n') || 'No shops yet' }, `${c.shops.length}`),
          h('td', money(companyValue(c))),
          h('td', { class: 'dim' }, c.aggression > 0.6 ? 'Cut-throat' : c.aggression > 0.35 ? 'Competitive' : 'Easy-going'),
        ),
      ),
    ),
    h('div.section', `Achievements (${Object.keys(s.achievements).length}/${ACHIEVEMENTS.length})`),
    h(
      'div.achievements',
      ...ACHIEVEMENTS.map((a) => {
        const got = s.achievements[a.id];
        const value = statValue(s, a.stat);
        return h(
          'div.achievement',
          { class: got ? 'got' : '', tip: `${a.description}${got ? `\nUnlocked on day ${got}` : a.at > 1 ? `\n${Math.min(a.at, Math.floor(value)).toLocaleString()} of ${a.at.toLocaleString()}` : ''}${a.xp ? `\nReward: ${a.xp} XP` : ''}` },
          icon(got ? 'trophy' : 'star', 16),
          h('div', h('div.name', a.name), !got && a.at > 1 && h('div.meter', h('div', { style: { width: `${Math.min(100, (value / a.at) * 100)}%`, background: 'var(--warn)' } }))),
        );
      }),
    ),
    h('div.section', 'Lifetime statistics'),
    h('div.statgrid', ...Object.entries(STAT_LABELS).map(([k, label]) => h('div.kv', h('span.k', label), h('span.v', k === 'revenue' ? money(Math.round(s.stats[k] ?? 0)) : Math.round(s.stats[k] ?? 0).toLocaleString()))), h('div.kv', h('span.k', 'Days in business'), h('span.v', String(statValue(s, 'day'))))),
    h('div.section', 'Company-wide upgrades'),
    ...upgradesFor(null).map(([id, d]) => {
      const level = upgradeLevel(s, COMPANY, id);
      const cost = upgradeCost(d, level);
      const locked = s.level < d.unlockLevel;
      return h('div.kv', { style: { alignItems: 'center' }, tip: d.description }, h('span.k', `${d.name}${d.maxLevel > 1 ? ` (${level}/${d.maxLevel})` : ''}`), level >= d.maxLevel ? h('span.good', 'Done') : h('button', { disabled: locked || s.money < cost, onclick: () => buyUpgrade(s, COMPANY, id) }, locked ? `Level ${d.unlockLevel}` : money(cost)));
    }),
    h('div.section', 'Bank'),
    ...s.loans.map((l) =>
      h(
        'div.kv',
        { style: { alignItems: 'center' }, tip: `Borrowed ${money(l.principal)} on day ${l.takenDay}. ${(l.dailyRate * 100).toFixed(2)}% interest a day on what is still owed.` },
        h('span.k', `${l.name}: ${money(Math.round(l.balance))} owed`),
        h('span.row', h('button', { disabled: s.money < Math.min(1000, l.balance), onclick: () => repayLoan(s, l.id, 1000) }, 'Repay $1,000'), h('button', { disabled: s.money < l.balance, onclick: () => repayLoan(s, l.id, l.balance) }, 'Repay all')),
      ),
    ),
    s.loans.length > 0 && h('div.kv', h('span.k', 'Daily repayments and interest'), h('span.v', money(Math.round(dailyLoanCost(s))))),
    ...EVENTS.loans.map((o) => {
      const why = canTakeLoan(s, o);
      const daily = o.amount / o.days + o.amount * loanRate(s, o);
      return h('div.kv', { style: { alignItems: 'center' }, tip: `${o.days} daily repayments of capital, plus ${(loanRate(s, o) * 100).toFixed(2)}% interest a day on the balance. First payment about ${money(Math.round(daily))}.` }, h('span.k', `${o.name}: ${money(o.amount)} over ${o.days} days`), h('button', { disabled: !!why, tip: why ?? undefined, onclick: () => takeLoan(s, o) }, why?.startsWith('Needs') ? why : 'Borrow'));
    }),
    h('div.note', `Going overdrawn costs ${Math.round(EVENTS.overdraftDailyRate * 100)}% a day. If cash falls to ${money(EVENTS.bankruptcyCash)} the bank closes you down.`),
  );
}

// ---------- Host ----------

const TITLES: Record<WindowId, string> = { businesses: 'Your businesses', dashboard: 'Shop dashboard', stock: 'Stock', property: 'Property', you: 'You', finances: 'Finances', staff: 'Staff', company: 'Company', news: 'Notifications' };
/** Windows that hold charts are wider, and are not rebuilt while the pointer is over them. */
const WIDE: WindowId[] = ['businesses', 'dashboard', 'finances', 'stock', 'staff', 'property'];

const OVERLAYS: Record<Overlay, { icon: string; name: string; tip: string; low: string; high: string; ramp: string }> = {
  traffic: { icon: 'feet', name: 'Foot traffic', tip: 'Where people have been walking over the last few hours.', low: 'Quiet', high: 'Busy', ramp: 'linear-gradient(90deg, rgba(57,135,229,0.08), rgba(57,135,229,0.9))' },
  clean: { icon: 'broom', name: 'Cleanliness', tip: 'How clean each of your businesses is.', low: 'Filthy', high: 'Spotless', ramp: 'linear-gradient(90deg, #d95926, #8f9bb0, #3987e5)' },
  theft: { icon: 'shield', name: 'Theft risk', tip: 'How tempting each shop is to shoplifters: the value on open shelves, less whatever guards and cameras put them off.', low: 'Safe', high: 'At risk', ramp: 'linear-gradient(90deg, #3987e5, #8f9bb0, #d95926)' },
  reach: { icon: 'target', name: 'Shop reach', tip: 'Where your customers live. Each dot is a resident who has been to the selected shop (or any of your shops if none is selected); bright dots are regulars. The ring holds four fifths of them.', low: 'Has visited', high: 'Regular', ramp: 'linear-gradient(90deg, rgba(57,135,229,0.35), #3987e5)' },
  happy: { icon: 'smile', name: 'Customer happiness', tip: 'How recent visitors felt when they left each business.', low: 'Unhappy', high: 'Delighted', ramp: 'linear-gradient(90deg, #d95926, #8f9bb0, #3987e5)' },
};

/** The sidebar and the floating window it opens. `focus` moves the camera to a lot. */
export function Sidebar(focus: (lotId: number) => void, openMenu: () => void): { el: HTMLElement; destroy(): void; toggle(id: WindowId): void } {
  let open: WindowId | null = null;
  let shownId: WindowId | null = null;
  const win = h('div.panel.float-window', { style: { display: 'none' } });
  const buttons: Record<WindowId, HTMLButtonElement> = {
    businesses: h('button', { tip: 'Your businesses (B)\nEvery shop you own, totals and the company ranking', onclick: () => toggle('businesses') }, icon('shop')),
    dashboard: h('button', { tip: 'Shop dashboard\nCharts for one business: takings, customers, best sellers, busiest hours', onclick: () => toggle('dashboard') }, icon('dashboard')),
    stock: h('button', { tip: 'Stock\nEvery shop\'s stock, what is running out, and reordering', onclick: () => toggle('stock') }, icon('box')),
    finances: h('button', { tip: 'Finances (F)\nIncome, expenses and net worth', onclick: () => toggle('finances') }, icon('chart')),
    property: h('button', { tip: 'Property\nEvery lot in the city, district prices, and your tenants', onclick: () => toggle('property') }, icon('home')),
    you: h('button', { tip: 'You\nYour energy, home and car', onclick: () => toggle('you') }, icon('user')),
    staff: h('button', { tip: 'Staff (T)\nEveryone on your payroll', onclick: () => toggle('staff') }, icon('people')),
    company: h('button', { tip: 'Company\nLevel, rivals, achievements, statistics, upgrades and bank loans', onclick: () => toggle('company') }, icon('trophy')),
    news: h('button', { style: { display: 'none' } }),
  };
  const openDashboard = (shopId: number): void => {
    dash.shopId = shopId;
    open = 'dashboard';
    render(true);
  };

  const jump = (lotId: number): void => {
    focus(lotId);
    selectLot(lotId);
  };

  const render = (force = false): void => {
    for (const id of Object.keys(buttons) as WindowId[]) buttons[id].classList.toggle('active', id === open);
    if (!open) {
      win.style.display = 'none';
      return;
    }
    // Do not pull the page out from under a click, an open dropdown or a chart being read.
    if (!force && (win.querySelector(':active') || (WIDE.includes(open) && win.matches(':hover')) || win.contains(document.activeElement) && document.activeElement?.tagName === 'SELECT')) return;
    win.style.display = 'flex';
    win.classList.toggle('wide', WIDE.includes(open));
    const scroll = shownId === open ? win.querySelector('.scroll')?.scrollTop ?? 0 : 0;
    shownId = open;
    const again = (): void => render(true);
    const body = open === 'businesses' ? empireOverview(jump, openDashboard) : open === 'dashboard' ? shopDashboard(again, jump) : open === 'finances' ? finances(again) : open === 'property' ? propertyWindow(again, jump) : open === 'you' ? youWindow(again) : open === 'stock' ? stockScreen(again, jump) : open === 'staff' ? staffScreen(again, jump) : open === 'company' ? company(jump) : notificationsWindow(again);
    setChildren(win, h('h3', h('span', TITLES[open]), h('button.close', { onclick: () => toggle(open!) }, '×')), body);
    body.scrollTop = scroll;
  };

  function toggle(id: WindowId): void {
    open = open === id ? null : id;
    render(true);
    // Opening the log is reading it.
    if (open === 'news') markAllRead();
  }

  // Live numbers without rebuilding on every sale: refresh twice a second while open.
  const timer = window.setInterval(() => open && open === 'company' && render(), 500);
  const slow = window.setInterval(() => open && (open === 'businesses' || open === 'dashboard' || open === 'stock' || open === 'staff' || open === 'property') && render(), 4000);

  const legend = h('div.panel.overlay-legend', { style: { display: 'none' } });
  const overlayBtns = (Object.keys(OVERLAYS) as Overlay[]).map((id) => h('button', { tip: `${OVERLAYS[id].name} overlay\n${OVERLAYS[id].tip}`, onclick: () => setOverlay(ui.overlay === id ? null : id) }, icon(OVERLAYS[id].icon)));
  const renderOverlay = (): void => {
    (Object.keys(OVERLAYS) as Overlay[]).forEach((id, i) => overlayBtns[i].classList.toggle('active', ui.overlay === id));
    const o = ui.overlay ? OVERLAYS[ui.overlay] : null;
    legend.style.display = o ? 'block' : 'none';
    if (o) setChildren(legend, h('b', o.name), h('div.ramp', { style: { background: o.ramp } }), h('div.ends', h('span', o.low), h('span', o.high)));
  };
  const offs = [bus.on('overlay:changed', renderOverlay), bus.on('notes:changed', () => open === 'news' && render()),
    bus.on('orders:changed', () => open === 'stock' && render()),
    bus.on('logistics:changed', () => open === 'stock' && render()),
    bus.on('finance:changed', () => (open === 'finances' || open === 'property') && render()),
    bus.on('player:changed', () => open === 'you' && render()),
    bus.on('window:open', ({ id, shopId }) => {
      if (id === 'dashboard' && shopId !== undefined) return openDashboard(shopId);
      open = id as WindowId;
      render(true);
    }), bus.on('time:hour', () => open === 'finances' && render()), bus.on('lot:selected', (id) => { if (id !== null && open) { open = null; render(true); } })];
  const el = h('div', h('div.sidebar', buttons.businesses, buttons.dashboard, buttons.stock, buttons.staff, buttons.finances, buttons.property, buttons.company, buttons.you, h('div.gap'), h('button', { tip: 'Controls and help (F1)', onclick: () => bus.emit('help:open') }, icon('help')), h('button', { tip: 'Menu (Esc)\nSave, load, settings', onclick: openMenu }, icon('menu'))), h('div.overlay-bar', { tip: 'Map overlays' }, ...overlayBtns), win, legend);
  el.style.pointerEvents = 'none';
  for (const child of Array.from(el.children) as HTMLElement[]) child.style.pointerEvents = 'auto';
  return {
    el,
    toggle,
    destroy: () => {
      clearInterval(timer);
      clearInterval(slow);
      offs.forEach((off) => off());
    },
  };
}
