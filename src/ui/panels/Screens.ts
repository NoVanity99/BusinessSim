import { bus } from '../../core/events';
import { money } from '../../core/format';
import { session, shopById, type GameState } from '../../core/state';
import { selectStaff } from '../../core/uiState';
import { EMPLOYEES, PRODUCTS, SHOP_TYPES } from '../../data';
import { inShift, shiftLength, type Employee } from '../../entities/Employee';
import { batchQty, shelfQty, storageCapacity, storageUsed, type ShopState } from '../../entities/Shop';
import { charFrame } from '../../art/actorArt';
import { rt } from '../../systems/ai/runtime';
import { freeStorage, incomingUnits, placeOrder, quoteOrder, type OrderLine } from '../../systems/economy/stock';
import { cancelContract, cancelFee, contractDailyCost, contractUnitPrice, dailyUse, signContract, supplierOf } from '../../systems/logistics/logistics';
import { ECONOMY, LOGISTICS } from '../../data';
import { dayOf } from '../../systems/time/clock';
import { matchOffer } from '../../systems/rivals/rivals';
import { prioritiesOf } from '../../systems/staff/agents';
import { dailyWageBill } from '../../systems/staff/staff';
import { formatHour } from '../../systems/time/clock';
import { h } from '../dom';
import { frameCanvas } from '../thumb';
import { roleTag } from './staffWidgets';

// ---------- Stock ----------

const kindOf = (p: string): string => PRODUCTS[p].kind ?? 'good';
const orderable = (p: string): boolean => PRODUCTS[p].wholesale > 0 && ['good', 'ingredient', 'fuel'].includes(kindOf(p));
/** How many days of stock "top up" aims for. */
const COVER_DAYS = 3;

/** What the stock screen is showing; kept between refreshes. */
const stockView: { problemsOnly: boolean; cart: Record<number, Record<string, number>> } = { problemsOnly: false, cart: {} };

interface StockRow {
  product: string;
  shelf: number;
  back: number;
  incoming: number;
  perDay: number;
  /** Days until it runs out at the current rate; Infinity if it is not selling. */
  daysLeft: number;
  status: 'out' | 'low' | 'ok' | 'idle';
  suggest: number;
}

export function stockRows(s: GameState, shop: ShopState): StockRow[] {
  const type = SHOP_TYPES[shop.type];
  const use = dailyUse(shop);
  const items = [...new Set([...type.products, ...type.supplies])].filter((p) => !['menu', 'service'].includes(kindOf(p)));
  return items.map((product) => {
    const shelf = shelfQty(shop, product);
    const back = batchQty(shop.storage[product]);
    const incoming = incomingUnits(s, shop.id, product);
    const perDay = use[product] ?? 0;
    const have = shelf + back;
    const daysLeft = perDay > 0.05 ? have / perDay : Infinity;
    // Something on display or in use that has run out matters even before any sales history exists.
    const wanted = perDay > 0.05 || shop.objects.some((o) => o.slots?.some((sl) => sl.product === product));
    const status: StockRow['status'] = !wanted ? 'idle' : have === 0 ? 'out' : daysLeft < 1 ? 'low' : 'ok';
    const target = perDay > 0.05 ? perDay * COVER_DAYS : wanted ? PRODUCTS[product].caseSize : 0;
    const suggest = orderable(product) ? Math.max(0, Math.ceil((target - have - incoming) / PRODUCTS[product].caseSize)) : 0;
    return { product, shelf, back, incoming, perDay, daysLeft, status, suggest };
  });
}

const STATUS: Record<StockRow['status'], [string, string]> = { out: ['Out', 'var(--danger)'], low: ['Low', 'var(--warn)'], ok: ['OK', 'var(--accent)'], idle: ['Not in use', 'var(--border)'] };

/** Every shop's stock in one place, with what is running out and one-click reordering. */
export function stockScreen(rerender: () => void, focus: (lotId: number) => void): HTMLElement {
  const s = session.state;
  const shops = s.shops.filter((sh) => stockRows(s, sh).length > 0);
  if (!shops.length) return h('div.scroll', h('div.note', { style: { marginTop: '0' } }, 'Open a business that keeps stock to manage it here.'));
  let problems = 0;

  const sections = shops.map((shop) => {
    const rows = stockRows(s, shop);
    const cart = (stockView.cart[shop.id] ??= {});
    const lines: OrderLine[] = Object.entries(cart).filter(([, c]) => c > 0).map(([product, cases]) => ({ product, cases }));
    const quote = quoteOrder(s, lines, false, shop);
    const free = freeStorage(s, shop);
    const bad = rows.filter((r) => r.status === 'out' || r.status === 'low');
    problems += bad.length;
    const shown = stockView.problemsOnly ? bad : rows.filter((r) => r.status !== 'idle' || r.shelf + r.back + r.incoming > 0);
    const suggested = rows.filter((r) => r.suggest > 0);
    return h(
      'div.stock-shop',
      h(
        'div.stock-head',
        h('span.dot', { style: { background: SHOP_TYPES[shop.type].color } }),
        h('b.clickable', { onclick: () => focus(shop.lotId), tip: 'Go to this business' }, shop.name),
        h('span.dim', { tip: 'Back-room space used, including what is on order.' }, `storage ${storageUsed(shop) + incomingUnits(s, shop.id)}/${storageCapacity(shop)}`),
        bad.length > 0 && h('span.tag', { style: { background: 'var(--warn)' } }, `${bad.length} running out`),
        supplierOf(s, shop) && h('span.dim', { tip: 'Stocked by your own vans. Orders placed here still come from the wholesaler.' }, `supplied by ${supplierOf(s, shop)!.name}`),
        shop.type === 'warehouse' && h('span.dim', { tip: 'Orders delivered to a warehouse are cheaper.' }, `${Math.round(ECONOMY.wholesale.warehouseDiscount * 100)}% off orders`),
        h('span', { style: { flex: '1' } }),
        h('label.check', { tip: 'With a manager on shift, stock for everything on the shelves is reordered automatically.' }, h('input', { type: 'checkbox', checked: shop.autoReorder, onchange: (e: Event) => { shop.autoReorder = (e.target as HTMLInputElement).checked; } }), 'Manager reorders'),
        h('button', { disabled: !suggested.length, tip: `Put enough in the order for about ${COVER_DAYS} days at the current rate of sale.`, onclick: () => { for (const r of suggested) cart[r.product] = r.suggest; rerender(); } }, 'Top up'),
      ),
      shown.length === 0
        ? h('div.dim', { style: { fontSize: '13px', padding: '4px 0' } }, stockView.problemsOnly ? 'Nothing running out.' : 'Nothing stocked yet.')
        : h(
            'table.grid',
            h('tr', h('th', 'Product'), h('th', ''), h('th', { tip: 'On display' }, 'Shelf'), h('th', { tip: 'In the back room' }, 'Back'), h('th', { tip: 'Ordered, on its way' }, 'Coming'), h('th', { tip: 'Units used per day lately' }, 'Per day'), h('th', { tip: 'How long what you have will last' }, 'Lasts'), h('th', 'Order (cases)')),
            ...shown.map((r) => {
              const d = PRODUCTS[r.product];
              const cases = cart[r.product] ?? 0;
              const set = (n: number): void => {
                cart[r.product] = Math.max(0, n);
                rerender();
              };
              return h(
                'tr',
                h('td', d.name),
                h('td', h('span.pill', { style: { background: STATUS[r.status][1] } }, STATUS[r.status][0])),
                h('td', r.shelf || ''),
                h('td', r.back || ''),
                h('td', r.incoming || ''),
                h('td', r.perDay > 0.05 ? Math.round(r.perDay) : ''),
                h('td', { class: r.daysLeft < 1 ? 'warn' : '' }, r.daysLeft === Infinity ? '' : r.daysLeft < 1 ? `${Math.max(1, Math.round(r.daysLeft * 24))} h` : `${r.daysLeft.toFixed(1)} d`),
                h('td', orderable(r.product) ? h('span.stepper', h('button', { disabled: cases <= 0, onclick: () => set(cases - 1) }, '−'), h('span', { tip: `${d.caseSize} per case` }, String(cases)), h('button', { onclick: () => set(cases + 1) }, '+')) : h('span.dim', kindOf(r.product) === 'crafted' ? 'made here' : '')),
              );
            }),
          ),
      lines.length > 0 &&
        h(
          'div.stock-order',
          h('span', `${quote.cases} case${quote.cases === 1 ? '' : 's'} · ${quote.units} units${quote.discount ? ` · ${Math.round(quote.discount * 100)}% bulk discount` : ''} · arrives in ${quote.hours} h`),
          quote.units > free && h('span.bad', `needs ${quote.units - free} more storage`),
          h('span', { style: { flex: '1' } }),
          h('button', { onclick: () => { stockView.cart[shop.id] = {}; rerender(); } }, 'Clear'),
          h('button.primary', { disabled: s.money < quote.total || quote.units > free, onclick: () => { if (placeOrder(s, shop, lines, false)) stockView.cart[shop.id] = {}; rerender(); } }, `Order for ${money(quote.total)}`),
        ),
    );
  });

  return h(
    'div.scroll.stock-screen',
    h(
      'div.dash-head',
      h('span', problems ? h('span.warn', `${problems} product${problems === 1 ? '' : 's'} out or about to run out`) : h('span.good', 'Everything is in stock')),
      h('span', { style: { flex: '1' } }),
      h('label.check', h('input', { type: 'checkbox', checked: stockView.problemsOnly, onchange: (e: Event) => { stockView.problemsOnly = (e.target as HTMLInputElement).checked; rerender(); } }), 'Only what is running out'),
      h('button', { tip: `Add a ${COVER_DAYS}-day top-up to every shop's order.`, onclick: () => { for (const shop of shops) for (const r of stockRows(s, shop)) if (r.suggest > 0) (stockView.cart[shop.id] ??= {})[r.product] = r.suggest; rerender(); } }, 'Top up everywhere'),
    ),
    ...sections,
    contractsSection(s, rerender),
  );
}

// ---------- Supplier contracts ----------

const draft: { supplier: string; shopId: number; product: string; cases: number } = { supplier: 'steady', shopId: 0, product: '', cases: 2 };

function contractsSection(s: GameState, rerender: () => void): HTMLElement {
  const shops = s.shops.filter((sh) => stockRows(s, sh).some((r) => orderable(r.product)));
  const shop = shops.find((sh) => sh.id === draft.shopId) ?? shops[0];
  const products = shop ? stockRows(s, shop).map((r) => r.product).filter(orderable) : [];
  if (shop) draft.shopId = shop.id;
  if (!products.includes(draft.product)) draft.product = products[0] ?? '';
  const def = LOGISTICS.suppliers[draft.supplier];
  draft.cases = Math.max(def.minCases, draft.cases);
  const unit = draft.product ? contractUnitPrice(s, draft.supplier, draft.product) : 0;
  const perDay = draft.product ? draft.cases * PRODUCTS[draft.product].caseSize * unit : 0;
  const pick = <K extends keyof typeof draft>(key: K) => (e: Event): void => {
    (draft[key] as unknown) = key === 'shopId' ? +(e.target as HTMLSelectElement).value : (e.target as HTMLSelectElement).value;
    rerender();
  };
  const today = dayOf(s.time);
  return h(
    'div.stock-shop',
    h('div.stock-head', h('b', 'Supplier contracts'), h('span.dim', 'A fixed delivery every morning at a locked price, whatever the market does.')),
    ...s.contracts.map((c) => {
      const to = s.shops.find((sh) => sh.id === c.shopId);
      const sup = LOGISTICS.suppliers[c.supplier];
      return h(
        'div.kv',
        h('span.k', `${sup.name}: ${c.cases} case${c.cases === 1 ? '' : 's'} of ${PRODUCTS[c.product].name.toLowerCase()} to ${to?.name ?? 'a closed shop'}`),
        h('span.v', `${money(contractDailyCost(c))}/day · ${Math.max(0, c.untilDay - today + 1)} d left `, h('button', { style: { padding: '1px 8px', fontSize: '12px' }, tip: cancelFee(c) ? `Ending it early costs ${money(cancelFee(c))}.` : 'No charge for ending this one early.', onclick: () => { cancelContract(s, c.id); rerender(); } }, 'End')),
      );
    }),
    shop && draft.product
      ? h(
          'div.contract-form',
          h('select', { onchange: pick('supplier'), tip: def.description }, ...Object.entries(LOGISTICS.suppliers).map(([id, d]) => h('option', { value: id, selected: id === draft.supplier }, `${d.name} (${Math.round(d.discount * 100)}% off, ${d.days} days)`))),
          h('select', { onchange: pick('shopId') }, ...shops.map((sh) => h('option', { value: sh.id, selected: sh.id === shop.id }, sh.name))),
          h('select', { onchange: pick('product') }, ...products.map((p) => h('option', { value: p, selected: p === draft.product }, PRODUCTS[p].name))),
          h('span.stepper', h('button', { disabled: draft.cases <= def.minCases, onclick: () => { draft.cases--; rerender(); } }, '−'), h('span', { tip: `At least ${def.minCases} a day with this supplier` }, `${draft.cases}`), h('button', { onclick: () => { draft.cases++; rerender(); } }, '+')),
          h('span.dim', `cases a day · ${money(unit)} each · ${money(Math.round(perDay))}/day`),
          h('button.primary', { style: { padding: '4px 12px', fontSize: '13px' }, onclick: () => { signContract(s, draft.supplier, shop, draft.product, draft.cases); rerender(); }, tip: `${def.description}${def.missedShare ? `\nIf you have no room for a delivery you still pay ${Math.round(def.missedShare * 100)}% of it.` : ''}` }, 'Sign'),
        )
      : h('div.dim', { style: { fontSize: '13px' } }, 'Open a shop that buys stock to sign a contract.'),
  );
}

// ---------- Staff ----------

const HOUR_W = 100 / 24;

/** A 24-hour track with the employee's shift as a bar that can be dragged and resized. */
function shiftTrack(e: Employee, shop: ShopState | undefined, changed: () => void): HTMLElement {
  const track = h('div.track');
  const label = h('span.shift-label');
  // Opening hours sit behind the shift as a lighter band.
  const band = (from: number, to: number, cls: string): HTMLElement[] => {
    const seg = (a: number, b: number): HTMLElement => h(`div.${cls}`, { style: { left: `${a * HOUR_W}%`, width: `${(b - a) * HOUR_W}%` } });
    return from < to ? [seg(from, to)] : [seg(from, 24), seg(0, to)];
  };
  const paint = (): void => {
    const len = shiftLength(e.shift);
    track.replaceChildren(
      ...(shop ? band(shop.hours[0], shop.hours[1], 'open') : []),
      ...[6, 12, 18].map((hr) => h('div.tick', { style: { left: `${hr * HOUR_W}%` } })),
      ...band(e.shift[0], e.shift[1], `shift${len > EMPLOYEES.overtimeAfterHours ? '.over' : ''}`),
    );
    label.textContent = `${formatHour(e.shift[0])}–${formatHour(e.shift[1])} · ${len} h`;
    label.classList.toggle('warn', len > EMPLOYEES.overtimeAfterHours);
  };
  paint();

  track.addEventListener('mousedown', (ev) => {
    ev.preventDefault();
    const rect = track.getBoundingClientRect();
    const hourAt = (x: number): number => Math.max(0, Math.min(24, ((x - rect.left) / rect.width) * 24));
    const start = hourAt(ev.clientX);
    const [from, to] = e.shift;
    const len = shiftLength(e.shift);
    const inside = inShift(e.shift, Math.floor(start) % 24);
    // Near an end of the bar: stretch that end. In the middle: slide the whole shift. Elsewhere: draw a new one.
    const dist = (a: number, b: number): number => Math.min(Math.abs(a - b), 24 - Math.abs(a - b));
    const mode = inside && dist(start, from) < 0.9 ? 'from' : inside && dist(start, to % 24 || 24) < 0.9 ? 'to' : inside ? 'slide' : 'draw';
    const move = (m: MouseEvent): void => {
      const hr = hourAt(m.clientX);
      if (mode === 'slide') {
        const shift = Math.round(hr - start);
        const nf = (((from + shift) % 24) + 24) % 24;
        e.shift = [nf, (nf + len) % 24 || 24];
      } else if (mode === 'from') {
        const nf = Math.round(hr) % 24;
        if (shiftLength([nf, to]) >= 1) e.shift = [nf, to];
      } else if (mode === 'to') {
        const nt = Math.round(hr) || 24;
        if (shiftLength([from, nt]) >= 1) e.shift = [from, nt];
      } else {
        const a = Math.floor(Math.min(start, hr));
        const b = Math.max(a + 1, Math.ceil(Math.max(start, hr)));
        e.shift = [a % 24, b];
      }
      paint();
    };
    const up = (): void => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      bus.emit('staff:changed');
      changed();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
  return h('div.schedule', track, label);
}

/** For each hour a shop is open, how many people are on shift, and whether anyone can serve. */
function coverage(s: GameState, shop: ShopState): HTMLElement {
  const team = s.staff.filter((e) => e.shopId === shop.id);
  const needsServer = SHOP_TYPES[shop.type].furniture.some((f) => f === 'register' || f === 'counter');
  const cells = Array.from({ length: 24 }, (_v, hr) => {
    const open = inShift(shop.hours, hr);
    const on = team.filter((e) => inShift(e.shift, hr));
    const served = !needsServer || on.some((e) => prioritiesOf(shop, e.role).includes('serve')) || (s.ownerAt?.shopId === shop.id && on.length === 0);
    const cls = !open ? 'closed' : on.length === 0 ? (s.ownerAt?.shopId === shop.id ? 'owner' : 'gap') : !served ? 'gap' : 'ok';
    return h(`div.cell.${cls}`, { tip: `${formatHour(hr)}: ${!open ? 'closed' : on.length ? `${on.length} on shift${served ? '' : ', nobody who serves customers'}` : s.ownerAt?.shopId === shop.id ? 'only you' : 'nobody on shift'}` }, on.length && open ? String(on.length) : '');
  });
  return h('div.coverage', ...cells);
}

/** Everyone on the payroll, grouped by shop, with shifts you can drag on a timeline. */
export function staffScreen(rerender: () => void, focus: (lotId: number) => void): HTMLElement {
  const s = session.state;
  if (!s.staff.length) return h('div.scroll', h('div.note', { style: { marginTop: '0' } }, `Nobody works for you yet. Hire from the Staff tab of a business. ${Object.keys(EMPLOYEES.roles).length} roles exist; each business lists the ones it can use.`));
  const total = s.staff.reduce((a, e) => a + dailyWageBill(e), 0);
  const hours = h('div.hours', ...[0, 6, 12, 18, 24].map((hr) => h('span', { style: { left: `${hr * HOUR_W}%` } }, hr === 24 ? '' : formatHour(hr))));

  const groups = s.shops
    .map((shop) => ({ shop, team: s.staff.filter((e) => e.shopId === shop.id) }))
    .filter((g) => g.team.length)
    .map(({ shop, team }) =>
      h(
        'div.staff-shop',
        h('div.stock-head', h('span.dot', { style: { background: SHOP_TYPES[shop.type].color } }), h('b.clickable', { onclick: () => focus(shop.lotId), tip: 'Go to this business' }, shop.name), h('span.dim', `open ${formatHour(shop.hours[0])}–${formatHour(shop.hours[1])} · ${money(Math.round(team.reduce((a, e) => a + dailyWageBill(e), 0)))}/day`)),
        h('div.staff-row.cover', h('div.who.dim', { tip: 'Green: covered. Red: open with nobody on shift, or nobody who serves customers.' }, 'Cover'), h('div.schedule', coverage(s, shop))),
        ...team.map((e) => {
          const offer = s.offers.find((o) => o.staffId === e.id);
          const agent = rt.staff.get(e.id);
          return h(
            'div.staff-row',
            h(
              'div.who',
              { onclick: () => { focus(shop.lotId); selectStaff(e.id); }, tip: `${e.name}\nEnergy ${Math.round(e.energy)}% · morale ${Math.round(e.morale)}%\n${money(e.wage)}/hour · ${money(Math.round(dailyWageBill(e)))}/day\nClick to find them` },
              frameCanvas(charFrame(e.role === 'mechanic' ? 3 : e.look, 'down', 0), 34, { x: 0, y: 0, w: 16, h: 13 }),
              h('div', h('div.name', e.name), h('div', roleTag(e.role))),
            ),
            shiftTrack(e, shopById(s, shop.id), rerender),
            h(
              'div.state',
              offer ? h('button.primary', { onclick: () => matchOffer(s, e.id), tip: 'A rival has made them an offer. Match it or they leave at midnight.' }, `Match ${money(offer.wage)}/h`) : h('span', { class: e.morale < 30 ? 'bad' : e.energy < 30 ? 'warn' : 'dim' }, e.morale < 30 ? 'Unhappy' : e.energy < 30 ? 'Tired' : agent?.activity ?? 'Off shift'),
            ),
          );
        }),
      ),
    );

  return h(
    'div.scroll.staff-screen',
    h('div.dash-head', h('span', `${s.staff.length} employee${s.staff.length === 1 ? '' : 's'} · ${money(Math.round(total))} a day in wages`), h('span', { style: { flex: '1' } }), h('span.dim', 'Drag a shift to move it, or drag its ends to change its length.')),
    h('div.staff-row.axis', h('div.who'), h('div.schedule', hours), h('div.state')),
    ...groups,
  );
}
