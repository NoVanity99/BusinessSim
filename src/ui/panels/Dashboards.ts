import { money } from '../../core/format';
import { session, shopById, type GameState } from '../../core/state';
import { NEIGHBORHOODS, PRODUCTS, SHOP_TYPES } from '../../data';
import type { ShopDayStats, ShopState } from '../../entities/Shop';
import { priceIndex, regularsOf, shopRating } from '../../systems/ai/residents';
import { netWorth } from '../../systems/economy/networth';
import { companyValue, rivalsNear } from '../../systems/rivals/rivals';
import { onDuty, staffOf } from '../../systems/staff/staff';
import { DAY_NAMES, dayOf } from '../../systems/time/clock';
import { barChart, CATEGORICAL, donutChart, foldParts, lineChart, SERIES_COLORS, sparkline } from '../charts';
import { h } from '../dom';

export type Range = 'daily' | 'weekly' | 'monthly';
const RANGES: Record<Range, { label: string; days: number; buckets: number; unit: string }> = {
  daily: { label: 'Daily', days: 1, buckets: 14, unit: 'day' },
  weekly: { label: 'Weekly', days: 7, buckets: 12, unit: 'week' },
  monthly: { label: 'Monthly', days: 28, buckets: 4, unit: 'month' },
};

/** What the dashboard is showing; kept between refreshes. */
export const dash: { shopId: number | null; range: Range } = { shopId: null, range: 'daily' };

interface Bucket extends ShopDayStats {
  label: string;
}

const CATEGORY_NAMES: Record<string, string> = { cards: 'Card packs', drinks: 'Drinks', fresh: 'Fresh food', frozen: 'Frozen', fuel: 'Fuel', grocery: 'Groceries', household: 'Household', menu: 'Menu', service: 'Services', singles: 'Single cards', snacks: 'Snacks', ingredient: 'Ingredients', vehicles: 'Cars', street: 'Street food', clothing: 'Clothing', electronics: 'Electronics', books: 'Books', pets: 'Pet supplies', health: 'Health' };
const fmt = (n: number): string => money(Math.round(n));
const pct = (n: number): string => `${Math.round(n * 100)}%`;

function addInto(a: ShopDayStats, b: ShopDayStats): void {
  a.customers += b.customers;
  a.served += b.served;
  a.walkouts += b.walkouts;
  a.revenue += b.revenue;
  a.unitsSold += b.unitsSold;
  a.costs += b.costs;
  for (const [k, v] of Object.entries(b.byProduct ?? {})) a.byProduct![k] = (a.byProduct![k] ?? 0) + v;
  (b.byHour ?? []).forEach((v, i) => (a.byHour![i] += v));
}

const blank = (label: string): Bucket => ({ label, customers: 0, served: 0, walkouts: 0, revenue: 0, unitsSold: 0, costs: 0, byProduct: {}, byHour: new Array(24).fill(0) });

/** A shop's history grouped into days, weeks or four-week months, oldest first, ending today. */
export function buckets(s: GameState, shop: ShopState, range: Range): Bucket[] {
  const R = RANGES[range];
  const today = dayOf(s.time);
  const days = [...shop.history, { day: today, ...shop.today }];
  // Buckets are aligned to the calendar: weeks start on day 1, 8, 15...
  const index = (day: number): number => Math.floor((day - 1) / R.days);
  const last = index(today);
  const first = Math.max(index(days[0].day), last - R.buckets + 1);
  const out: Bucket[] = [];
  for (let i = first; i <= last; i++) {
    const label = range === 'daily' ? `${DAY_NAMES[i % 7]} ${i + 1}` : range === 'weekly' ? `Wk ${i + 1}` : `Mo ${i + 1}`;
    out.push(blank(label));
  }
  for (const d of days) {
    const i = index(d.day) - first;
    if (i >= 0 && i < out.length) addInto(out[i], d);
  }
  return out;
}

/** A headline number with its change against the period before. */
function tile(label: string, value: string, now?: number, before?: number, goodWhenUp = true, tip?: string, sub?: string): HTMLElement {
  let delta: HTMLElement | false = false;
  if (sub) return h('div.tile', { tip }, h('div.label', label), h('div.value', value), h('div.delta.dim', sub));
  if (now !== undefined && before !== undefined && before !== 0) {
    const change = (now - before) / Math.abs(before);
    if (Math.abs(change) >= 0.005) delta = h('div.delta', { class: change > 0 === goodWhenUp ? 'good' : 'bad' }, `${change > 0 ? '▲' : '▼'} ${Math.abs(Math.round(change * 100))}%`);
  }
  return h('div.tile', { tip }, h('div.label', label), h('div.value', value), delta || h('div.delta.dim', now !== undefined && before !== undefined ? 'no change' : ' '));
}

const rangeSwitch = (rerender: () => void): HTMLElement =>
  h(
    'div.segmented',
    ...(Object.keys(RANGES) as Range[]).map((r) =>
      h('button', { class: dash.range === r ? 'active' : '', onclick: () => { dash.range = r; rerender(); } }, RANGES[r].label),
    ),
  );

/** One shop in depth: headline figures, money over time, customers, what sells, and when people come. */
export function shopDashboard(rerender: () => void, focus: (lotId: number) => void): HTMLElement {
  const s = session.state;
  const shop = (dash.shopId !== null ? shopById(s, dash.shopId) : undefined) ?? s.shops[0];
  if (!shop) return h('div.scroll', h('div.note', { style: { marginTop: '0' } }, 'Open a business to see its dashboard.'));
  dash.shopId = shop.id;
  const R = RANGES[dash.range];
  const bs = buckets(s, shop, dash.range);
  const cur = bs[bs.length - 1];
  const prev = bs.length > 1 ? bs[bs.length - 2] : undefined;
  const conv = (b?: ShopDayStats): number | undefined => (b && b.customers ? b.served / b.customers : undefined);
  const ticket = (b?: ShopDayStats): number | undefined => (b && b.served ? b.revenue / b.served : undefined);
  const rating = shopRating(shop);
  const period = dash.range === 'daily' ? 'Today' : dash.range === 'weekly' ? 'This week' : 'This month';
  const versus = `Compared with the ${R.unit} before.`;
  const last = dash.range === 'daily' ? 'yesterday' : dash.range === 'weekly' ? 'last week' : 'last month';

  // Sales by category over everything on screen.
  const byCategory: Record<string, number> = {};
  const byItem: Record<string, number> = {};
  const hours = new Array(24).fill(0);
  let daysWithHours = 0;
  for (const b of bs) {
    for (const [p, v] of Object.entries(b.byProduct ?? {})) {
      const cat = PRODUCTS[p]?.category ?? 'service';
      byCategory[cat] = (byCategory[cat] ?? 0) + v;
      byItem[p] = (byItem[p] ?? 0) + v;
    }
    (b.byHour ?? []).forEach((v, i) => (hours[i] += v));
    if ((b.byHour ?? []).some((v) => v > 0)) daysWithHours += R.days;
  }
  const best = Object.entries(byItem).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const bestMax = best[0]?.[1] ?? 1;
  const openHours = hours.map((_v, i) => i).filter((i) => hours[i] > 0);
  const hFrom = openHours.length ? Math.max(0, openHours[0] - 1) : 8;
  const hTo = openHours.length ? Math.min(23, openHours[openHours.length - 1] + 1) : 20;
  const hourLabels = Array.from({ length: hTo - hFrom + 1 }, (_v, i) => `${hFrom + i}:00`);
  const rivals = rivalsNear(s, shop);

  return h(
    'div.scroll.dashboard',
    h(
      'div.dash-head',
      h(
        'select',
        { onchange: (ev: Event) => { dash.shopId = +(ev.target as HTMLSelectElement).value; rerender(); } },
        ...s.shops.map((sh) => h('option', { value: sh.id, selected: sh.id === shop.id }, sh.name)),
      ),
      h('span.dim', `${SHOP_TYPES[shop.type].name} · ${NEIGHBORHOODS[session.city.lots[shop.lotId].district].name}`),
      h('span', { style: { flex: '1' } }),
      rangeSwitch(rerender),
      h('button', { onclick: () => focus(shop.lotId), tip: 'Show this business on the map' }, 'Go to'),
    ),
    h(
      'div.tiles',
      // The current period is still running, so totals are shown beside the last full one rather than as a change.
      tile(`${period}: takings`, fmt(cur.revenue), undefined, undefined, true, undefined, prev ? `${last} ${fmt(prev.revenue)}` : undefined),
      tile('Profit', fmt(cur.revenue - cur.costs), undefined, undefined, true, 'Takings minus stock, wages, rent and utilities charged to this shop.', prev ? `${last} ${fmt(prev.revenue - prev.costs)}` : undefined),
      tile('Customers', String(cur.customers), undefined, undefined, true, undefined, prev ? `${last} ${prev.customers}` : undefined),
      tile('Served', conv(cur) !== undefined ? pct(conv(cur)!) : '–', conv(cur), conv(prev), true, `Share of people who came in and bought something. ${versus}`),
      tile('Average spend', ticket(cur) !== undefined ? money(ticket(cur)!) : '–', ticket(cur), ticket(prev), true, `Takings per paying customer. ${versus}`),
      tile('Rating', rating ? `${rating.toFixed(1)} ★` : '–', undefined, undefined, true, `${shop.reviews.length} review${shop.reviews.length === 1 ? '' : 's'} · ${regularsOf(s, shop.id)} regulars · reputation ${Math.round(shop.reputation)}`),
    ),
    h('div.section', `Takings and costs per ${R.unit}`),
    lineChart(bs.map((b) => b.label), [{ name: 'Takings', color: SERIES_COLORS.income, values: bs.map((b) => Math.round(b.revenue)) }, { name: 'Costs', color: SERIES_COLORS.expense, values: bs.map((b) => Math.round(b.costs)) }], fmt, 720, 190),
    h(
      'div.dash-row',
      h(
        'div',
        h('div.section', `Customers per ${R.unit}`),
        barChart(bs.map((b) => b.label), [{ name: 'Served', color: CATEGORICAL[0], values: bs.map((b) => b.served) }, { name: 'Left without buying', color: CATEGORICAL[1], values: bs.map((b) => Math.max(0, b.customers - b.served)) }], (n) => String(Math.round(n)), 360, 170),
      ),
      h(
        'div',
        h('div.section', { tip: 'Average number of people through the door in each hour, over the period shown.' }, 'Busiest hours'),
        barChart(hourLabels, [{ name: 'Customers per day', color: CATEGORICAL[0], values: hourLabels.map((_l, i) => Math.round((hours[hFrom + i] / Math.max(1, daysWithHours)) * 10) / 10) }], (n) => String(Math.round(n * 10) / 10), 360, 170),
      ),
    ),
    h(
      'div.dash-row',
      h('div', h('div.section', 'Where the money comes from'), donutChart(foldParts(Object.entries(byCategory).map(([k, v]) => ({ name: CATEGORY_NAMES[k] ?? k, value: v }))), fmt, 'Takings')),
      h(
        'div',
        h('div.section', 'Best sellers'),
        best.length === 0 && h('div.dim', { style: { fontSize: '13px' } }, 'No sales recorded yet.'),
        ...best.map(([p, v]) => h('div.rank', h('span.name', PRODUCTS[p]?.name ?? (p === 'tournament' ? 'Tournament entry' : p)), h('div.meter', h('div', { style: { width: `${(v / bestMax) * 100}%`, background: CATEGORICAL[0] } })), h('span.val', fmt(v)))),
        rivals.length > 0 && h('div.section', 'Competition nearby'),
        ...rivals.map((r) => h('div.kv', h('span.k', r.name), h('span.v', `prices ${Math.round((r.priceIndex - 1) * 100)}% · you ${Math.round((priceIndex(s, shop) - 1) * 100)}%`))),
      ),
    ),
  );
}

/** Every business at a glance, with totals, who brings in the money, and how the rivals compare. */
export function empireOverview(focus: (lotId: number) => void, openDashboard: (shopId: number) => void): HTMLElement {
  const s = session.state;
  if (!s.shops.length) return h('div.scroll', h('div.note', { style: { marginTop: '0' } }, 'You have no businesses yet. Rent a lot with a yellow outline and open one.'));
  const week = (shop: ShopState): ShopDayStats[] => [...shop.history.slice(-6), shop.today];
  const sum = (list: ShopDayStats[], f: (d: ShopDayStats) => number): number => list.reduce((a, d) => a + f(d), 0);
  const today = sum(s.shops.map((sh) => sh.today), (d) => d.revenue);
  const yRevenue = sum(s.shops.map((sh) => sh.yesterday), (d) => d.revenue);
  const yProfit = sum(s.shops.map((sh) => sh.yesterday), (d) => d.revenue - d.costs);
  const customers = sum(s.shops.map((sh) => sh.today), (d) => d.customers);
  const onShift = s.staff.filter((e) => onDuty(s, e)).length;
  const worth = netWorth(s, session.city);
  const ranking = [{ name: s.companyName, value: worth, color: 'var(--accent)', shops: s.shops.length, you: true }, ...s.rivals.map((c) => ({ name: c.name, value: companyValue(c), color: c.color, shops: c.shops.length, you: false }))].sort((a, b) => b.value - a.value);
  const top = Math.max(1, ...ranking.map((r) => r.value));

  const rows = s.shops.map((shop) => {
    const lot = session.city.lots[shop.lotId];
    const y = shop.yesterday;
    const profit = y.revenue - y.costs;
    const staff = staffOf(s, shop.id);
    const rating = shopRating(shop);
    return h(
      'tr.clickable',
      { onclick: () => focus(shop.lotId), tip: 'Go to this business' },
      h('td', h('span.dot', { style: { background: SHOP_TYPES[shop.type].color } }), shop.name, h('div.dim', { style: { fontSize: '11.5px' } }, NEIGHBORHOODS[lot.district].name)),
      h('td', { class: shop.reputation < 35 ? 'bad' : shop.reputation > 65 ? 'good' : '' }, `${Math.round(shop.reputation)}`, rating ? h('span.dim', ` · ${rating.toFixed(1)}★`) : ''),
      h('td', fmt(shop.today.revenue)),
      h('td', `${shop.today.served}/${shop.today.customers}`),
      h('td', { class: profit < 0 ? 'bad' : '' }, fmt(profit)),
      h('td', { tip: 'Takings over the last seven days' }, sparkline(week(shop).map((d) => d.revenue))),
      h('td', `${staff.filter((e) => onDuty(s, e)).length}/${staff.length}`),
      h('td', h('button', { onclick: (ev: Event) => { ev.stopPropagation(); openDashboard(shop.id); }, tip: 'Open this shop\'s dashboard' }, 'Stats')),
    );
  });

  return h(
    'div.scroll.dashboard',
    h(
      'div.tiles',
      tile('Takings today', fmt(today), undefined, undefined),
      tile('Takings yesterday', fmt(yRevenue)),
      tile('Profit yesterday', fmt(yProfit)),
      tile('Customers today', String(customers)),
      tile('Staff on shift', `${onShift}/${s.staff.length}`),
      tile('Net worth', fmt(worth)),
    ),
    h(
      'div.dash-row',
      h('div', h('div.section', 'Takings by business, last 7 days'), donutChart(foldParts(s.shops.map((sh) => ({ name: sh.name, value: sum(week(sh), (d) => d.revenue) }))), fmt, '7 days')),
      h(
        'div',
        h('div.section', { tip: 'Net worth for you; cash plus the value of their shops for rivals.' }, 'Company ranking'),
        ...ranking.map((r, i) => h('div.rank', h('span.name', { class: r.you ? 'you' : '' }, `${i + 1}. ${r.name}`), h('div.meter', h('div', { style: { width: `${Math.max(2, (Math.max(0, r.value) / top) * 100)}%`, background: r.color } })), h('span.val', fmt(r.value)))),
      ),
    ),
    h('div.section', 'Businesses'),
    h('table.grid', h('tr', h('th', 'Business'), h('th', { tip: 'Reputation 0 to 100, and review rating' }, 'Rep'), h('th', 'Today'), h('th', { tip: 'Customers served of those who came in today' }, 'Served'), h('th', { tip: 'Yesterday: takings minus stock orders, wages, rent and utilities' }, 'Profit (yest.)'), h('th', '7 days'), h('th', { tip: 'On shift now / total' }, 'Staff'), h('th', '')), ...rows),
  );
}
