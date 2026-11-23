import { bus } from '../../core/events';
import { money } from '../../core/format';
import { session, shopOnLot, type GameState } from '../../core/state';
import { selectLot, setTool, ui } from '../../core/uiState';
import { ECONOMY, FURNITURE, NEIGHBORHOODS, PRODUCTS, SHOP_TYPES } from '../../data';
import { batchQty, registers, shelfQty, storageCapacity, storageUsed, type ShopState } from '../../entities/Shop';
import { buildCost, closeShop } from '../../systems/build/build';
import { marketPrice, roundPrice, trendOf, wholesalePrice } from '../../systems/economy/market';
import { rentOf } from '../../systems/economy/property';
import { freeStorage, hoursUntil, incomingUnits, placeOrder, quoteOrder } from '../../systems/economy/stock';
import { formatHour } from '../../systems/time/clock';
import { h, setChildren } from '../dom';
import { EMPLOYEES } from '../../data';
import { shiftLength, type Employee } from '../../entities/Employee';
import { deepCleanCost, utilityCost } from '../../systems/shop/status';
import { tryPay } from '../../systems/economy/finance';
import { managerOnDuty } from '../../systems/staff/manager';
import { dailyWageBill, fire, giveBonus, giveRaise, hire, onDuty, staffOf } from '../../systems/staff/staff';
import { selectStaff } from '../../core/uiState';
import { roleTag, skillBars, traitTags } from './staffWidgets';
import { inStorage } from '../../systems/economy/stock';
import { openPacks, PACK_ODDS, scheduleTournament, TOURNAMENT_COST } from '../../systems/shop/cards';
import { FACTORY_SALE_SHARE, factoryPrice, sellWholesale } from '../../systems/shop/production';
import { COURIER_FEE, destinationsFor, transferStock } from '../../systems/economy/transfer';
import { fairPrice } from '../../systems/shop/pricing';
import { openOrders } from '../../systems/shop/kitchen';
import { defOf } from '../../entities/Shop';
import { dayOf } from '../../systems/time/clock';
import { buyUpgrade, upgradeCost, upgradeLevel, upgradesFor } from '../../systems/progress/upgrades';
import { shopDemandMult } from '../../systems/events/events';

interface Tab {
  el: HTMLElement;
  /** Refresh numbers in place without rebuilding controls. */
  update(): void;
}

const dot = (color: string): HTMLElement => h('span.dot', { style: { background: color } });

// ---------- Overview ----------

function overviewTab(s: GameState, shop: ShopState): Tab {
  const lot = session.city.lots[shop.lotId];
  const type = SHOP_TYPES[shop.type];
  const body = h('div');
  const hourSelect = (index: 0 | 1): HTMLElement =>
    h(
      'select',
      {
        onchange: (e: Event) => {
          shop.hours[index] = +(e.target as HTMLSelectElement).value;
          bus.emit('shop:changed', shop.id);
        },
      },
      ...Array.from({ length: 25 }, (_v, hr) => hr)
        .filter((hr) => (index === 0 ? hr < 24 : hr > 0))
        .map((hr) => h('option', { value: hr, selected: shop.hours[index] === hr }, formatHour(hr))),
    );

  const update = (): void => {
    if ((body.contains(document.activeElement) && document.activeElement?.tagName === 'SELECT') || body.querySelector(':active')) return;
    const regs = registers(shop);
    const staffed = regs.some((r) => s.ownerAt?.shopId === shop.id && s.ownerAt.objectId === r.id) || staffOf(s, shop.id).some((e) => e.role === 'cashier' && onDuty(s, e));
    const stocked = shop.objects.some((o) => o.slots?.some((sl) => batchQty(sl.batches) > 0));
    const flow = type.flow;
    const needsCheckout = flow === 'retail' || flow === 'counter';
    const has = (pred: (o: (typeof shop.objects)[number]) => boolean): boolean => shop.objects.some(pred);
    const broken = shop.objects.filter((o) => o.broken).length;
    const menu = type.products.filter((p) => PRODUCTS[p].kind === 'menu');
    const problems = [
      needsCheckout && !regs.length && (flow === 'counter' ? 'No order counter. Customers cannot order.' : 'No checkout. Customers cannot pay.'),
      needsCheckout && regs.length > 0 && !staffed && 'Nobody is working the counter.',
      flow === 'retail' && shop.type !== 'gas' && !stocked && 'Nothing on the shelves.',
      flow === 'counter' && !menu.some((p) => !PRODUCTS[p].station || has((o) => defOf(o).station === PRODUCTS[p].station)) && 'No cooking equipment. Nothing on the menu can be made.',
      flow === 'counter' && !menu.some((p) => Object.keys(PRODUCTS[p].recipe ?? {}).every((i) => inStorage(shop, i) > 0)) && 'No ingredients in the back room.',
      flow === 'service' && !(type.plan ?? []).every((svc) => has((o) => defOf(o).service === svc)) && 'Missing machines. Customers need a washer and a dryer.',
      flow === 'park' && !has((o) => defOf(o).service === 'svc_ticket') && 'No ticket gate. Guests cannot get in.',
      flow === 'park' && !has((o) => defOf(o).service === 'ride') && 'No attractions.',
      flow === 'factory' && !has((o) => defOf(o).kind === 'producer' && !!o.recipe) && 'No machine has a recipe set.',
      flow === 'depot' && !has((o) => defOf(o).kind === 'vending') && 'No vending machines placed yet. Pick one in Build and click any pavement.',
      shop.type === 'gas' && !has((o) => defOf(o).service === 'fuel') && 'No fuel pumps.',
      shop.type === 'gas' && has((o) => defOf(o).service === 'fuel') && inStorage(shop, 'fuel') <= 0 && 'The fuel tanks are empty.',
      broken > 0 && `${broken} machine${broken === 1 ? ' is' : 's are'} broken. Click one to repair it.`,
      shop.closed && 'Closed by you.',
    ].filter(Boolean) as string[];
    const today = dayOf(s.time);

    setChildren(
      body,
      h('div.kv', h('span.k', 'Type'), h('span.v', type.name)),
      h('div.kv', h('span.k', 'Location'), h('span.v', `${NEIGHBORHOODS[lot.district].name}, lot #${lot.id}`)),
      h('div.kv', h('span.k', 'Rent'), h('span.v', s.lots[lot.id]?.owner === 'owned' ? 'Owned' : `${money(rentOf(s, lot))} / day`)),
      h('div.kv', { tip: 'Customers remember good and bad visits. Reputation draws people in or keeps them away.' }, h('span.k', 'Reputation'), h('span.v', `${Math.round(shop.reputation)} / 100`)),
      h('div.meter', h('div', { style: { width: `${shop.reputation}%`, background: 'var(--accent)' } })),
      h('div.kv', { tip: 'Every visitor leaves a little mess. Dirt puts customers in a bad mood. Bins slow it down; a cleaner removes it.' }, h('span.k', 'Cleanliness'), h('span.v', { class: shop.dirt > 55 ? 'bad' : shop.dirt > 30 ? 'warn' : '' }, `${Math.round(100 - shop.dirt)}%`)),
      shop.dirt > 15 && h('div.actions', { style: { margin: '2px 0 8px' } }, h('button', { disabled: s.money < deepCleanCost(shop), onclick: () => { if (tryPay(s, deepCleanCost(shop), 'maintenance')) { shop.dirt = 0; bus.emit('shop:changed', shop.id); } }, tip: 'Pay a cleaning crew for a one-off scrub.' }, `Deep clean (${money(deepCleanCost(shop))})`)),
      shopDemandMult(s, shop) !== 1 && h('div.kv', { tip: 'Advertising, rivals and viral reviews change how many passers-by come in.' }, h('span.k', 'Customer interest'), h('span.v', { class: shopDemandMult(s, shop) < 1 ? 'bad' : 'good' }, `${Math.round(shopDemandMult(s, shop) * 100)}%`)),
      h('div.kv', h('span.k', 'Back-room storage'), h('span.v', `${storageUsed(shop)} / ${storageCapacity(shop)} units`)),
      h('div.kv', { tip: 'Charged at midnight: a base fee, floor area and powered equipment.' }, h('span.k', 'Utilities'), h('span.v', `${money(utilityCost(s, shop))} / day`)),
      h('div.kv', h('span.k', 'Wages'), h('span.v', `${money(Math.round(staffOf(s, shop.id).reduce((a, e) => a + dailyWageBill(e), 0)))} / day`)),
      h('div.section', 'Opening hours'),
      h('div.row', hourSelect(0), 'to', hourSelect(1)),
      h('label.check', { style: { marginTop: '8px' } }, h('input', { type: 'checkbox', checked: shop.closed, onchange: (e: Event) => { shop.closed = (e.target as HTMLInputElement).checked; bus.emit('shop:changed', shop.id); } }), 'Closed until further notice'),
      h('label.check', { style: { marginTop: '6px' }, tip: 'With a manager on shift, stock for every product on your shelves is reordered automatically.' }, h('input', { type: 'checkbox', checked: shop.autoReorder, onchange: (e: Event) => { shop.autoReorder = (e.target as HTMLInputElement).checked; bus.emit('shop:changed', shop.id); } }), `Manager reorders stock${managerOnDuty(s, shop) ? '' : ' (no manager on shift)'}`),
      h('div.section', 'Today'),
      h('div.kv', h('span.k', 'Revenue'), h('span.v', money(shop.today.revenue))),
      h('div.kv', h('span.k', 'Customers served'), h('span.v', `${shop.today.served} of ${shop.today.customers}`)),
      h('div.kv', h('span.k', 'Left unhappy'), h('span.v', { class: shop.today.walkouts ? 'warn' : '' }, shop.today.walkouts)),
      flow === 'counter' && h('div.kv', h('span.k', 'Orders in the kitchen'), h('span.v', openOrders(shop.id))),
      shop.type === 'cardshop' &&
        h(
          'div.actions',
          { style: { margin: '6px 0' } },
          (shop.eventDay ?? 0) >= today
            ? h('div.good', { style: { fontSize: '13px' } }, shop.eventDay === today ? 'Tournament day! Players pay an entry fee at the tables.' : 'Tournament booked for tomorrow.')
            : h('button', { disabled: s.money < TOURNAMENT_COST || !has((o) => defOf(o).service === 'play'), onclick: () => scheduleTournament(s, shop), tip: 'Players flood in tomorrow, pay an entry fee at each play table and buy packs. Needs at least one play table.' }, `Host a tournament tomorrow (${money(TOURNAMENT_COST)})`),
        ),
      problems.length > 0 && h('div.section', 'Needs attention'),
      ...problems.map((p) => h('div.warn', { style: { fontSize: '13px', marginBottom: '3px' } }, `• ${p}`)),
      h('div.actions', h('button.danger', { tip: 'Sells all equipment and liquidates stock at a loss. You keep the lot.', onclick: () => { if (confirm(`Close ${shop.name} for good?`)) closeShop(s, shop); } }, 'Close this business')),
    );
  };
  update();
  return { el: body, update };
}

// ---------- Build ----------

function buildTab(s: GameState, shop: ShopState): Tab {
  const type = SHOP_TYPES[shop.type];
  const body = h('div');
  const ids = [...Object.keys(FURNITURE).filter((id) => FURNITURE[id].category === 'structure'), ...type.furniture];
  const categories = [...new Set(ids.map((id) => FURNITURE[id].category))];
  const buttons = new Map<string, HTMLButtonElement>();
  const moveBtn = h('button', { onclick: () => setTool(ui.tool?.type === 'move' ? null : { type: 'move' }), tip: 'Click a piece of furniture to pick it up, then click to put it down.' }, 'Move');
  const sellBtn = h('button', { onclick: () => setTool(ui.tool?.type === 'sell' ? null : { type: 'sell' }), tip: `Click furniture to sell it for ${Math.round(ECONOMY.build.sellBackShare * 100)}% of its price, or a wall or door to knock it down.` }, 'Sell / Demolish');

  body.append(h('div.row', moveBtn, sellBtn));
  for (const cat of categories) {
    const grid = h('div.palette');
    for (const id of ids.filter((i) => FURNITURE[i].category === cat)) {
      const d = FURNITURE[id];
      const btn = h(
        'button',
        {
          tip: `${d.description}${d.decor ? `\nDecor ${d.decor > 0 ? '+' : ''}${d.decor}` : ''}${d.power ? `\nPower use ${d.power}` : ''}`,
          onclick: () => setTool(ui.tool?.type === 'place' && ui.tool.def === id && ui.tool.movingId === undefined ? null : { type: 'place', def: id, rot: 0 }),
        },
        h('span.swatch', { style: { background: d.color } }),
        h('span.name', d.name),
        h('span.cost', money(buildCost(s, id))),
      );
      buttons.set(id, btn);
      grid.append(btn);
    }
    body.append(h('div.section', cat), grid);
  }
  body.append(h('div.note', 'Click to place. Drag to paint floors and walls. R rotates. Right-click or Esc puts the tool away. The yellow square shows where customers stand.'));

  const update = (): void => {
    const t = ui.tool;
    buttons.forEach((btn, id) => {
      btn.classList.toggle('active', t?.type === 'place' && t.def === id && t.movingId === undefined);
      btn.disabled = s.money < buildCost(s, id);
    });
    moveBtn.classList.toggle('active', t?.type === 'move' || (t?.type === 'place' && t.movingId !== undefined));
    sellBtn.classList.toggle('active', t?.type === 'sell');
  };
  update();
  return { el: body, update };
}

// ---------- Stock ----------

const kindOf = (p: string): string => PRODUCTS[p].kind ?? 'good';
/** Things that sit in the back room: everything except made-to-order items and services. */
const stockItems = (shop: ShopState): string[] => {
  const type = SHOP_TYPES[shop.type];
  return [...new Set([...type.products, ...type.supplies])].filter((p) => !['menu', 'service'].includes(kindOf(p)));
};
const orderable = (p: string): boolean => PRODUCTS[p].wholesale > 0 && ['good', 'ingredient', 'fuel'].includes(kindOf(p));

function stockTab(s: GameState, shop: ShopState): Tab {
  const type = SHOP_TYPES[shop.type];
  const items = stockItems(shop);
  const cart: Record<string, number> = {};
  let express = false;
  const cells = new Map<string, { store: HTMLElement; shelf: HTMLElement; incoming: HTMLElement; qty: HTMLElement; cost: HTMLElement }>();
  const totals = h('div.totals');
  const deliveries = h('div');
  const capacity = h('div.kv');
  const extras = h('div');
  const orderBtn = h('button.primary', { onclick: () => order() }, 'Place order');

  const rows = items.map((p) => {
    const d = PRODUCTS[p];
    const c = { store: h('td'), shelf: h('td'), incoming: h('td'), qty: h('span', '0'), cost: h('td') };
    cells.set(p, c);
    const step = (n: number) => (e: MouseEvent) => {
      cart[p] = Math.max(0, (cart[p] ?? 0) + n * (e.shiftKey ? 5 : 1));
      update();
    };
    const note = d.recipe ? `\nMade from ${Object.entries(d.recipe).map(([i, n]) => `${n}× ${PRODUCTS[i].name}`).join(' + ')}` : '';
    return h(
      'tr',
      h('td', { tip: `${orderable(p) ? `${d.caseSize} per case` : kindOf(p) === 'collectible' ? 'Comes from opening booster packs' : 'Made in your factory'}${d.shelfLife ? ` · keeps ${d.shelfLife} day${d.shelfLife === 1 ? '' : 's'}` : ''}${note}` }, dot(d.color), d.name),
      c.store,
      c.shelf,
      c.incoming,
      h('td', orderable(p) ? h('span.stepper', h('button', { onclick: step(-1) }, '−'), c.qty, h('button', { onclick: step(1), tip: 'Add a case. Hold Shift for five.' }, '+')) : ''),
      c.cost,
    );
  });

  const lines = (): { product: string; cases: number }[] => Object.entries(cart).filter(([, n]) => n > 0).map(([product, cases]) => ({ product, cases }));

  function order(): void {
    if (placeOrder(s, shop, lines(), express)) {
      for (const k of Object.keys(cart)) delete cart[k];
      update();
    }
  }

  /** Per-business extras: cracking packs, selling and shipping what a factory makes. */
  function renderExtras(): void {
    if (extras.querySelector(':active') || (extras.contains(document.activeElement) && document.activeElement?.tagName === 'SELECT')) return;
    const parts: (HTMLElement | false)[] = [];
    if (items.includes('booster') && items.includes('single_rare')) {
      const packs = inStorage(shop, 'booster');
      parts.push(
        h('div.section', 'Open packs'),
        h('div.row', h('button', { disabled: packs < 1, onclick: () => openPacks(s, shop, 1) }, 'Open 1'), h('button', { disabled: packs < 10, onclick: () => openPacks(s, shop, 10) }, 'Open 10'), h('span.dim', `${packs} sealed in storage`)),
        h('div.note', `Each pack holds ${PACK_ODDS.commons} commons, a ${Math.round(PACK_ODDS.rareChance * 100)}% chance of a rare and a ${Math.round(PACK_ODDS.ultraChance * 100)}% chance of an ultra rare. Singles go in a display case; collectors pay well for them, but their prices swing from day to day.`),
      );
    }
    const made = items.filter((p) => PRODUCTS[p].recipe && inStorage(shop, p) > 0 && type.flow === 'factory');
    if (type.flow === 'factory') {
      parts.push(
        h('div.section', 'Finished goods'),
        h('label.check', { tip: `Sell each batch to the wholesale market the moment it is made, at ${Math.round(FACTORY_SALE_SHARE * 100)}% of the wholesale price.` }, h('input', { type: 'checkbox', checked: !!shop.autoSell, onchange: (e: Event) => { shop.autoSell = (e.target as HTMLInputElement).checked; } }), 'Sell everything wholesale automatically'),
        made.length === 0 && h('div.note', 'Nothing made yet. Click a machine, choose a recipe, and keep its ingredients in stock.'),
        ...made.map((p) => {
          const qty = inStorage(shop, p);
          const dests = destinationsFor(s, shop, p);
          const select = h('select', h('option', { value: 0 }, dests.length ? 'Ship to…' : 'No shop stocks this'), ...dests.map((d) => h('option', { value: d.id }, d.name)));
          select.onchange = () => {
            const dest = dests.find((d) => d.id === +select.value);
            if (dest) transferStock(s, shop, dest, p, qty);
            select.value = '0';
          };
          return h('div.kv', { style: { alignItems: 'center' } }, h('span.k', dot(PRODUCTS[p].color), `${qty} ${PRODUCTS[p].name}`), h('span.row', h('button', { onclick: () => sellWholesale(s, shop, p, qty), tip: 'Sell the lot to the wholesale market now.' }, `Sell ${money(Math.round(qty * factoryPrice(s, p)))}`), select));
        }),
        h('div.note', `Shipping to your own shops lets you sell at full retail price. A courier costs ${money(COURIER_FEE)} a trip; a driver on shift here does it free.`),
      );
    }
    setChildren(extras, ...parts);
  }

  function update(): void {
    for (const p of items) {
      const c = cells.get(p)!;
      c.store.textContent = String(inStorage(shop, p));
      c.shelf.textContent = String(shelfQty(shop, p) || '');
      const inc = incomingUnits(s, shop.id, p);
      c.incoming.textContent = inc ? `+${Math.round(inc)}` : '';
      c.qty.textContent = String(cart[p] ?? 0);
      if (!orderable(p)) c.cost.textContent = '';
      else c.cost.textContent = money(Math.round((cart[p] || 1) * PRODUCTS[p].caseSize * wholesalePrice(s, p) * 100) / 100);
      c.cost.className = cart[p] ? '' : 'dim';
    }
    const q = quoteOrder(s, lines(), express);
    const free = freeStorage(s, shop);
    setChildren(capacity, h('span.k', 'Storage free (after deliveries)'), h('span.v', { class: free < q.units ? 'bad' : '' }, `${Math.round(free)} units`));
    setChildren(
      totals,
      h('div.kv', h('span.k', `${q.cases} cases, ${q.units} units`), h('span.v', money(q.subtotal))),
      q.discount > 0 && h('div.kv', h('span.k', `Bulk discount ${Math.round(q.discount * 100)}%`), h('span.v.good', `−${money(q.discountAmount)}`)),
      q.surcharge > 0 && h('div.kv', h('span.k', 'Express surcharge'), h('span.v', money(q.surcharge))),
      q.cases > 0 && h('div.kv', h('span.k', 'Delivery'), h('span.v', money(q.deliveryFee))),
      h('div.kv', h('span.k', h('b', 'Total')), h('span.v', h('b', money(q.total)))),
    );
    orderBtn.disabled = q.cases === 0 || q.total > s.money || q.units > free;
    orderBtn.textContent = q.cases ? `Place order · arrives in ${q.hours} h` : 'Place order';
    const mine = s.orders.filter((o) => o.shopId === shop.id).sort((a, b) => a.arriveAt - b.arriveAt);
    setChildren(
      deliveries,
      mine.length > 0 && h('div.section', 'On the way'),
      ...mine.map((o) =>
        h('div.kv', h('span.k', o.lines.map((l) => `${Math.round(l.cases * PRODUCTS[l.product].caseSize)} ${PRODUCTS[l.product].name}`).join(', ').slice(0, 44)), h('span.v', `${hoursUntil(s, o).toFixed(1)} h`)),
      ),
    );
    renderExtras();
  }

  const tiers = ECONOMY.wholesale.bulkDiscounts.map((t) => `${t.cases}+ cases: ${Math.round(t.discount * 100)}% off`).join('\n');
  const usesShelves = type.furniture.some((f) => FURNITURE[f].kind === 'shelf' || FURNITURE[f].kind === 'vending');
  const el = h(
    'div',
    capacity,
    h('table.grid', h('tr', h('th', 'Product'), h('th', { tip: 'Units in the back room' }, 'Store'), h('th', { tip: 'Units on display' }, usesShelves ? 'Shelf' : ''), h('th', { tip: 'Units on the way' }, 'Due'), h('th', 'Cases'), h('th', { tip: 'Price per case, or the cost of the cases you picked' }, 'Cost')), ...rows),
    totals,
    h('label.check', { style: { margin: '8px 0' }, tip: `Standard delivery takes ${ECONOMY.wholesale.standardHours} hours. Express takes ${ECONOMY.wholesale.expressHours} and costs ${Math.round(ECONOMY.wholesale.expressSurcharge * 100)}% more.` }, h('input', { type: 'checkbox', onchange: (e: Event) => { express = (e.target as HTMLInputElement).checked; update(); } }), 'Express delivery'),
    h('div.actions', { tip: `Bulk discounts\n${tiers}` }, orderBtn),
    deliveries,
    extras,
    usesShelves && h('div.note', 'Deliveries go to the back room. Click a shelf or machine to choose what it holds and fill it.'),
    type.flow === 'counter' && h('div.note', 'Ingredients are used straight from the back room as orders are cooked.'),
  );
  update();
  return { el, update };
}

// ---------- Prices ----------

/** What one unit costs you: its wholesale price, or the ingredients that go into it. */
function unitCost(s: GameState, p: string): number {
  const d = PRODUCTS[p];
  let cost = d.kind === 'crafted' || !d.wholesale || d.kind === 'menu' ? 0 : wholesalePrice(s, p);
  if (d.recipe && (d.kind === 'menu' || d.kind === 'service' || d.kind === 'crafted')) {
    let inputs = 0;
    for (const [i, n] of Object.entries(d.recipe)) inputs += unitCost(s, i) * n;
    cost += inputs / (d.kind === 'crafted' ? d.batch ?? 1 : 1);
  }
  return cost;
}

function pricesTab(s: GameState, shop: ShopState): Tab {
  const type = SHOP_TYPES[shop.type];
  if (type.flow === 'factory') {
    const body = h('div');
    const update = (): void =>
      setChildren(
        body,
        h('table.grid', h('tr', h('th', 'Product'), h('th', { tip: 'Ingredients per unit' }, 'Cost'), h('th', { tip: 'What the wholesale market pays you per unit today' }, 'Wholesale'), h('th', { tip: 'What it retails for in your own shops' }, 'Retail')), ...type.products.filter((p) => PRODUCTS[p].recipe).map((p) => h('tr', h('td', dot(PRODUCTS[p].color), PRODUCTS[p].name), h('td', money(Math.round(unitCost(s, p) * 100) / 100)), h('td', money(Math.round(factoryPrice(s, p) * 100) / 100)), h('td', PRODUCTS[p].market ? money(Math.round(marketPrice(s, p) * 100) / 100) : 'ingredient')))),
        h('div.note', 'A factory has no customers of its own. Sell what it makes to the wholesale market from the Stock tab, or ship it to your shops and set the retail price there.'),
      );
    update();
    return { el: body, update };
  }
  const priced = type.products.filter((p) => PRODUCTS[p].market > 0);
  const cells = new Map<string, { cost: HTMLElement; market: HTMLElement; price: HTMLElement; margin: HTMLElement }>();

  const setPrice = (p: string, value: number): void => {
    shop.prices[p] = roundPrice(value);
    bus.emit('prices:changed', shop.id);
  };

  const rows = priced.map((p) => {
    const d = PRODUCTS[p];
    const c = { cost: h('td'), market: h('td'), price: h('span'), margin: h('td') };
    cells.set(p, c);
    const big = d.market >= 20;
    const step = (dir: number) => (e: MouseEvent) => setPrice(p, shop.prices[p] + dir * (e.shiftKey ? (big ? 5 : 0.5) : big ? 0.5 : 0.05));
    return h('tr', h('td', dot(d.color), d.name), c.cost, c.market, h('td', h('span.stepper', h('button', { onclick: step(-1) }, '−'), c.price, h('button', { onclick: step(1), tip: 'Hold Shift for bigger steps.' }, '+'))), c.margin);
  });

  function update(): void {
    for (const p of priced) {
      const c = cells.get(p)!;
      const cost = unitCost(s, p);
      const market = fairPrice(s, shop, p);
      const price = (shop.prices[p] ??= roundPrice(market));
      const trend = trendOf(s, p);
      c.cost.textContent = cost ? money(Math.round(cost * 100) / 100) : '';
      c.market.textContent = `${money(Math.round(market * 100) / 100)}${trend > 0.005 ? ' ▲' : trend < -0.005 ? ' ▼' : ''}`;
      c.price.textContent = price.toFixed(2);
      const ratio = price / market;
      c.price.className = ratio <= 1.02 ? 'good' : ratio <= 1.18 ? 'warn' : 'bad';
      const margin = (price - cost) / price;
      c.margin.textContent = `${Math.round(margin * 100)}%`;
      c.margin.className = margin < 0 ? 'bad' : '';
    }
  }

  const setAll = (factor: number) => () => {
    for (const p of priced) shop.prices[p] = roundPrice(fairPrice(s, shop, p) * factor);
    bus.emit('prices:changed', shop.id);
  };

  const el = h(
    'div',
    h('div.row', { style: { marginBottom: '8px' } }, h('button', { onclick: setAll(0.92), tip: 'Undercut the market to pull in bargain hunters.' }, 'All −8%'), h('button', { onclick: setAll(1) }, 'All at fair price'), h('button', { onclick: setAll(1.1), tip: 'More profit per sale, but fewer people buy.' }, 'All +10%')),
    h('table.grid', h('tr', h('th', 'Product'), h('th', { tip: 'What one costs you today: wholesale price, ingredients, or running costs' }, 'Cost'), h('th', { tip: 'What customers here expect to pay today. Arrows show the market trend since yesterday.' }, 'Fair'), h('th', 'Your price'), h('th', { tip: 'Share of the price that is profit' }, 'Margin')), ...rows),
    h('div.note', `Green is at or below the fair price, yellow is a little high, red drives customers away and hurts your reputation. Wealthier neighbourhoods tolerate more markup.${type.decorWeight ? ' Here, good decor raises what people will pay.' : ''}${type.flow === 'park' ? ' The fair ticket price rises with every working attraction.' : ''}`),
  );
  update();
  return { el, update };
}

// ---------- Staff ----------

function staffTab(s: GameState, shop: ShopState): Tab {
  const type = SHOP_TYPES[shop.type];
  const body = h('div');

  const hourSelect = (e: Employee, index: 0 | 1): HTMLElement =>
    h(
      'select',
      {
        onchange: (ev: Event) => {
          e.shift[index] = +(ev.target as HTMLSelectElement).value;
          bus.emit('staff:changed');
        },
      },
      ...Array.from({ length: 25 }, (_v, hr) => hr)
        .filter((hr) => (index === 0 ? hr < 24 : hr > 0))
        .map((hr) => h('option', { value: hr, selected: e.shift[index] === hr }, formatHour(hr))),
    );

  const employeeCard = (e: Employee): HTMLElement => {
    const len = shiftLength(e.shift);
    const regs = registers(shop);
    const fair = e.wage / e.fairWage;
    return h(
      'div.person',
      h('div.head', h('span.name', { onclick: () => selectStaff(e.id), tip: 'Show details' }, e.name), roleTag(e.role)),
      skillBars(e),
      h('div.line', ...traitTags(e)),
      h(
        'div.bars',
        h('div', `Energy ${Math.round(e.energy)}%`, h('div.meter', h('div', { style: { width: `${e.energy}%`, background: e.energy > 40 ? 'var(--info)' : 'var(--warn)' } }))),
        h('div', { tip: 'Fair pay, sane hours, a clean shop and a manager keep morale up. Miserable staff work slowly, skip shifts and quit.' }, `Morale ${Math.round(e.morale)}%`, h('div.meter', h('div', { style: { width: `${e.morale}%`, background: e.morale > 40 ? 'var(--accent)' : 'var(--danger)' } }))),
      ),
      h('div.line', 'Shift', hourSelect(e, 0), 'to', hourSelect(e, 1), h('span', { class: len > EMPLOYEES.overtimeAfterHours ? 'warn' : 'dim', tip: `Hours past ${EMPLOYEES.overtimeAfterHours} are paid at ${EMPLOYEES.overtimeMult}x and wear people down.` }, `${len} h${len > EMPLOYEES.overtimeAfterHours ? ' (overtime)' : ''}`)),
      e.role === 'cashier' &&
        regs.length > 1 &&
        h(
          'div.line',
          'Checkout',
          h(
            'select',
            { onchange: (ev: Event) => { e.stationId = +(ev.target as HTMLSelectElement).value || null; bus.emit('shop:changed', shop.id); } },
            h('option', { value: 0 }, 'Any free'),
            ...regs.map((r, i) => h('option', { value: r.id, selected: e.stationId === r.id }, `Checkout ${i + 1}`)),
          ),
        ),
      h(
        'div.line',
        h('span', { class: fair < 0.95 ? 'warn' : '', tip: `Someone with these skills usually earns about ${money(Math.round(e.fairWage * 100) / 100)} an hour.` }, `${money(e.wage)}/h · ${money(Math.round(dailyWageBill(e)))}/day`),
        h('span', { style: { flex: '1' } }),
        h('button', { onclick: () => giveRaise(e, 0.5), tip: 'Raise their wage by $0.50 an hour. Lifts morale now and for good.' }, 'Raise'),
        h('button', { disabled: s.money < 50, onclick: () => giveBonus(s, e, 50), tip: 'A one-off $50 bonus for a quick morale boost.' }, 'Bonus'),
        h('button.danger', { onclick: () => fire(s, e.id) }, 'Fire'),
      ),
    );
  };

  const candidateCard = (c: Employee | (typeof s.candidates)[number]): HTMLElement =>
    h(
      'div.person',
      h('div.head', h('span', { style: { fontWeight: '600' } }, c.name), roleTag(c.role)),
      skillBars(c),
      h('div.line', ...traitTags(c), h('span', { style: { flex: '1' } }), h('span', `${money(c.wage)}/h`), h('button.primary', { disabled: s.money < EMPLOYEES.hiringFee, onclick: () => hire(s, c.id, shop.id), tip: `Hiring costs ${money(EMPLOYEES.hiringFee)}. Wages are paid for each hour worked.` }, 'Hire')),
    );

  const update = (): void => {
    if ((body.contains(document.activeElement) && document.activeElement?.tagName === 'SELECT') || body.querySelector(':active')) return;
    const mine = staffOf(s, shop.id);
    const pool = s.candidates.filter((c) => type.roles.includes(c.role));
    setChildren(
      body,
      h('div.section', `Team (${mine.length})`),
      mine.length === 0 && h('div.note', { style: { marginTop: '0' } }, 'Nobody works here yet. You can run one checkout yourself; everything else needs staff.'),
      ...mine.map(employeeCard),
      h('div.section', 'Looking for work'),
      pool.length === 0 && h('div.note', { style: { marginTop: '0' } }, 'No suitable candidates today. New people apply every morning.'),
      ...pool.map(candidateCard),
      h('div.note', `Roles useful here: ${type.roles.map((r) => EMPLOYEES.roles[r].name).join(', ')}. The pool refreshes daily.`),
    );
  };
  update();
  return { el: body, update };
}

// ---------- Upgrades ----------

function upgradesTab(s: GameState, shop: ShopState): Tab {
  const body = h('div');
  const update = (): void => {
    if (body.querySelector(':active')) return;
    setChildren(
      body,
      ...upgradesFor(shop).map(([id, d]) => {
        const level = upgradeLevel(s, shop.id, id);
        const maxed = level >= d.maxLevel;
        const locked = s.level < d.unlockLevel;
        const cost = upgradeCost(d, level);
        return h(
          'div.person',
          h('div.head', h('span', { style: { fontWeight: '600' } }, d.name), h('span.dim', d.maxLevel > 1 ? `Level ${level} / ${d.maxLevel}` : level ? 'Installed' : '')),
          h('div.sub', { style: { marginBottom: '6px' } }, d.description),
          h('div.line', h('span', { style: { flex: '1' } }), maxed ? h('span.good', 'Fully upgraded') : h('button.primary', { disabled: locked || s.money < cost, onclick: () => buyUpgrade(s, shop.id, id) }, locked ? `Needs level ${d.unlockLevel}` : `Buy for ${money(cost)}`)),
        );
      }),
      h('div.note', 'These apply to this business only. Company-wide upgrades are in the Company window.'),
    );
  };
  update();
  return { el: body, update };
}

// ---------- Panel ----------

const TABS = { overview: 'Overview', build: 'Build', stock: 'Stock', prices: 'Prices', staff: 'Staff', upgrades: 'Upgrades' } as const;
type TabId = keyof typeof TABS;

export function ShopPanel(): { el: HTMLElement; destroy(): void } {
  const el = h('div.panel.shop-panel', { style: { display: 'none' } });
  let shop: ShopState | undefined;
  let tabId: TabId = 'overview';
  let tab: Tab | null = null;
  let pending = false;

  const build = (): void => {
    const s = session.state;
    shop = ui.selectedLot !== null ? shopOnLot(s, ui.selectedLot) : undefined;
    if (!shop) {
      el.style.display = 'none';
      tab = null;
      return;
    }
    const current = shop;
    el.style.display = 'flex';
    tab = { overview: overviewTab, build: buildTab, stock: stockTab, prices: pricesTab, staff: staffTab, upgrades: upgradesTab }[tabId](s, current);
    const name = h('input', { type: 'text', value: current.name, maxLength: 28, style: { flex: '1', minWidth: '0', fontWeight: '600' }, tip: 'Rename this business' });
    name.addEventListener('change', () => {
      current.name = name.value.trim() || current.name;
      bus.emit('shop:changed', current.id);
    });
    setChildren(
      el,
      h('div.row', name, h('button.close', { onclick: () => selectLot(null), tip: 'Close (Esc)' }, '×')),
      h(
        'div.tabs',
        ...(Object.keys(TABS) as TabId[]).map((id) =>
          h('button', { class: id === tabId ? 'active' : '', onclick: () => { if (id !== 'build') setTool(null); tabId = id; build(); } }, TABS[id]),
        ),
      ),
      h('div.tab-body', tab.el),
    );
  };

  const refresh = (): void => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      tab?.update();
    });
  };

  const offs = [
    bus.on('lot:selected', build),
    bus.on('shop:created', build),
    bus.on('shop:removed', build),
    bus.on('shop:changed', refresh),
    bus.on('stock:changed', refresh),
    bus.on('orders:changed', refresh),
    bus.on('prices:changed', refresh),
    bus.on('market:changed', refresh),
    bus.on('money:changed', refresh),
    bus.on('tool:changed', refresh),
    bus.on('time:hour', refresh),
    bus.on('staff:changed', refresh),
    bus.on('upgrades:changed', refresh),
  ];
  return { el, destroy: () => offs.forEach((off) => off()) };
}
