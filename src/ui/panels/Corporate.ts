import { money } from '../../core/format';
import { session, shopOnLot, type GameState } from '../../core/state';
import { CORPORATE, NEIGHBORHOODS } from '../../data';
import { acceptInvestor, buyBack, buybackPrice, daysToTax, declineInvestor, insured, premiumPerDay, propertyIndex, setInsurance, taxForecast, totalStake, valuation, type Policy } from '../../systems/economy/corporate';
import { buyLot, evictFee, evictTenant, letLot, priceOf, rentLot, rentOf, saleValue, tenantRent } from '../../systems/economy/property';
import { franchiseOnLot } from '../../systems/logistics/franchise';
import { buyCar, carOf, homeOf, isTired, moveHome, visitsLeft } from '../../systems/player/player';
import { companyOf, rivalOnLot } from '../../systems/rivals/rivals';
import { CATEGORICAL, lineChart, sparkline } from '../charts';
import { h } from '../dom';

const pct = (v: number): string => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v * 100))}%`;

// ---------- Finances: tax, investors, insurance, index ----------

/** The parts of the Finances window that concern the company rather than the day's trading. */
export function financeExtras(s: GameState, rerender: () => void): HTMLElement[] {
  const tax = taxForecast(s);
  const names = [s.companyName, ...s.rivals.map((c) => c.name)];
  const colors = [CATEGORICAL[0], ...s.rivals.map((_c, i) => CATEGORICAL[i + 1])];
  const index = s.companyIndex;
  const out: HTMLElement[] = [];

  if (index.length > 1) {
    out.push(
      h('div.section', { tip: 'What each company is worth, day by day: net worth for you, cash plus shops for the rivals.' }, 'Company index'),
      lineChart(index.map((d) => `Day ${d.day}`), names.map((n, i) => ({ name: n, color: colors[i], values: index.map((d) => Math.max(0, d.values[n] ?? 0)) })), (n) => money(Math.round(n)), 720, 180),
    );
  }

  out.push(
    h('div.section', 'Tax'),
    h('div.kv', { tip: `${Math.round(CORPORATE.tax.profitRate * 100)}% of the week's trading profit, plus a small charge on property you own. Loans, property deals and refunds are left out.` }, h('span.k', `Due in ${daysToTax(s)} day${daysToTax(s) === 1 ? '' : 's'}`), h('span.v', { class: tax.total > s.money ? 'warn' : '' }, `about ${money(tax.total)}`)),
    h('div.kv', h('span.k', 'Trading profit this tax week'), h('span.v', { class: tax.profit < 0 ? 'bad' : '' }, money(Math.round(tax.profit)))),
  );
  if (tax.propertyTax > 0) out.push(h('div.kv', h('span.k', 'Of which property tax'), h('span.v', money(Math.round(tax.propertyTax)))));

  out.push(h('div.section', { tip: 'Investors pay cash now for a share of the company, and take that share of each day\'s trading profit until you buy them out.' }, `Investors (${Math.round(totalStake(s) * 100)}% of the company sold)`));
  for (const o of s.investorOffers) {
    out.push(
      h(
        'div.offer-card',
        h('div', h('b', o.name), ` offers ${money(o.amount)} for ${Math.round(o.stake * 100)}% of the company.`),
        h('div.dim', `That values the company at ${money(Math.round(o.amount / o.stake))}. They would take ${Math.round(o.stake * 100)}% of every day's trading profit.`),
        h('div.row', h('button', { onclick: () => { declineInvestor(s, o.id); rerender(); } }, 'Decline'), h('button.primary', { onclick: () => { acceptInvestor(s, o.id); rerender(); } }, `Accept ${money(o.amount)}`)),
      ),
    );
  }
  if (!s.investors.length && !s.investorOffers.length) out.push(h('div.dim', { style: { fontSize: '13px' } }, s.level < CORPORATE.investors.minLevel ? `Investors take an interest from level ${CORPORATE.investors.minLevel}.` : `Nobody has a stake in the company. It is valued at about ${money(Math.round(valuation(s)))}; offers arrive from time to time.`));
  for (const inv of s.investors) {
    const price = buybackPrice(s, inv);
    out.push(h('div.kv', h('span.k', `${inv.name}: ${Math.round(inv.stake * 100)}% since day ${inv.sinceDay}`), h('span.v', h('button', { style: { padding: '1px 8px', fontSize: '12px' }, disabled: s.money < price, onclick: () => { buyBack(s, inv); rerender(); }, tip: `They paid ${money(inv.paid)}. Buying them out ends their share of the profits.` }, `Buy out for ${money(price)}`))));
  }

  out.push(h('div.section', 'Insurance'));
  for (const [id, d] of Object.entries(CORPORATE.insurance) as [Policy, (typeof CORPORATE.insurance)[Policy]][]) {
    out.push(
      h(
        'label.check.policy',
        { tip: d.description },
        h('input', { type: 'checkbox', checked: insured(s, id), onchange: (e: Event) => { setInsurance(s, id, (e.target as HTMLInputElement).checked); rerender(); } }),
        h('span.name', d.name),
        h('span.dim', d.description),
        h('span.cost', `${money(premiumPerDay(s, id))}/day`),
      ),
    );
  }
  return out;
}

// ---------- Property ----------

const propertyView: { district: string; mine: boolean } = { district: 'all', mine: false };

/** Every lot in the city: what it costs, where prices are heading, and who holds it. */
export function propertyWindow(rerender: () => void, focus: (lotId: number) => void): HTMLElement {
  const s = session.state;
  const { city } = session;
  const districts = Object.keys(NEIGHBORHOODS).filter((d) => city.lots.some((l) => l.district === d && l.rentable));
  const history = s.propertyHistory ?? [];
  const owned = Object.entries(s.lots).filter(([, o]) => o.owner === 'owned');
  const portfolio = owned.reduce((a, [id]) => a + saleValue(s, city.lots[+id]), 0);
  const paid = owned.reduce((a, [id, o]) => a + (o.paid ?? saleValue(s, city.lots[+id])), 0);
  const rentIn = Object.entries(s.lots).reduce((a, [, o]) => a + (o.tenant?.rent ?? 0), 0);
  const rentOut = Object.entries(s.lots).reduce((a, [id, o]) => a + (o.owner === 'rented' ? rentOf(s, city.lots[+id]) : 0), 0);

  const lots = city.lots.filter((l) => l.rentable && (propertyView.district === 'all' || l.district === propertyView.district) && (!propertyView.mine || s.lots[l.id]));
  const rows = lots
    .sort((a, b) => (s.lots[b.id] ? 1 : 0) - (s.lots[a.id] ? 1 : 0) || priceOf(s, a) - priceOf(s, b))
    .slice(0, 60)
    .map((lot) => {
      const own = s.lots[lot.id];
      const shop = shopOnLot(s, lot.id);
      const rival = rivalOnLot(s, lot.id);
      const franchise = franchiseOnLot(s, lot.id);
      const status = own?.tenant ? `Let: ${own.tenant.name}` : shop ? shop.name : own ? (own.owner === 'owned' ? 'Yours, empty' : 'Leased, empty') : rival ? companyOf(s, rival).name : franchise ? 'Your franchise' : 'Free';
      const gain = own?.owner === 'owned' && own.paid ? saleValue(s, lot) / own.paid - 1 : null;
      const taken = !!rival || !!franchise;
      return h(
        'tr.clickable',
        { onclick: () => focus(lot.id), tip: 'Go to this lot' },
        h('td', h('span.dot', { style: { background: NEIGHBORHOODS[lot.district].color } }), `#${lot.id} · ${NEIGHBORHOODS[lot.district].name}`),
        h('td', `${lot.w}×${lot.h}`),
        h('td', money(rentOf(s, lot))),
        h('td', money(priceOf(s, lot))),
        h('td', { class: own ? 'good' : taken ? 'dim' : '' }, status, gain !== null && Math.abs(gain) >= 0.01 ? h('span', { class: gain > 0 ? 'good' : 'bad' }, ` ${pct(gain)}`) : ''),
        h(
          'td',
          !own && !taken && h('button', { disabled: s.money < priceOf(s, lot), onclick: (e: Event) => { e.stopPropagation(); buyLot(s, lot); rerender(); } }, 'Buy'),
          !own && !taken && h('button', { onclick: (e: Event) => { e.stopPropagation(); rentLot(s, lot); rerender(); } }, 'Rent'),
          own?.owner === 'owned' && !shop && !own.tenant && h('button', { onclick: (e: Event) => { e.stopPropagation(); letLot(s, lot); rerender(); }, tip: `A tenant would pay ${money(tenantRent(s, lot))} a day.` }, 'Let'),
          own?.tenant && h('button', { disabled: s.money < evictFee(s, lot), onclick: (e: Event) => { e.stopPropagation(); evictTenant(s, lot); rerender(); }, tip: `Buy the tenant out of their lease for ${money(evictFee(s, lot))}.` }, 'End tenancy'),
        ),
      );
    });

  return h(
    'div.scroll.dashboard',
    h(
      'div.tiles',
      { style: { gridTemplateColumns: 'repeat(4, 1fr)' } },
      h('div.tile', h('div.label', 'Lots you own'), h('div.value', `${owned.length}`), h('div.delta.dim', `worth ${money(Math.round(portfolio))}`)),
      h('div.tile', { tip: 'What your property would fetch today against what you paid for it.' }, h('div.label', 'Gain on property'), h('div.value', { class: portfolio - paid < 0 ? 'bad' : '' }, money(Math.round(portfolio - paid))), h('div.delta.dim', paid ? pct(portfolio / paid - 1) : ' ')),
      h('div.tile', h('div.label', 'Rent from tenants'), h('div.value', `${money(rentIn)}`), h('div.delta.dim', 'per day')),
      h('div.tile', h('div.label', 'Rent you pay'), h('div.value', `${money(rentOut)}`), h('div.delta.dim', 'per day')),
    ),
    h('div.section', { tip: 'Prices and rents in each district against where they started. They drift from day to day, and rise where shops are doing well.' }, 'The market'),
    h(
      'div.districts',
      ...districts.map((d) => {
        const now = propertyIndex(s, d);
        const weekAgo = history.length > 7 ? history[history.length - 8].index[d] ?? 1 : history[0]?.index[d] ?? 1;
        return h(
          'div.district',
          { class: propertyView.district === d ? 'active' : '', onclick: () => { propertyView.district = propertyView.district === d ? 'all' : d; rerender(); }, tip: `${NEIGHBORHOODS[d].description}\nClick to show only lots here.` },
          h('div.name', h('span.dot', { style: { background: NEIGHBORHOODS[d].color } }), NEIGHBORHOODS[d].name),
          h('div.row', h('b', `${Math.round(now * 100)}`), h('span', { class: now >= weekAgo ? 'good' : 'bad' }, `${now >= weekAgo ? '▲' : '▼'} ${Math.abs(Math.round((now / weekAgo - 1) * 100))}% this week`), sparkline(history.slice(-14).map((x) => x.index[d] ?? 1), CATEGORICAL[0], 70, 20)),
        );
      }),
    ),
    h('div.dash-head', { style: { marginTop: '12px' } }, h('b', propertyView.district === 'all' ? 'All lots' : `Lots in ${NEIGHBORHOODS[propertyView.district].name}`), h('span', { style: { flex: '1' } }), h('label.check', h('input', { type: 'checkbox', checked: propertyView.mine, onchange: (e: Event) => { propertyView.mine = (e.target as HTMLInputElement).checked; rerender(); } }), 'Only mine')),
    h('table.grid', h('tr', h('th', 'Lot'), h('th', 'Size'), h('th', 'Rent/day'), h('th', 'Price'), h('th', 'Held by'), h('th', '')), ...rows),
    h('div.note', `Selling an owned lot fetches the market price less a ${Math.round(CORPORATE.property.saleFee * 100)}% fee. An owned lot with no shop on it can be let to a tenant for ${Math.round(CORPORATE.property.tenantRentShare * 100)}% of the going rent.`),
  );
}

// ---------- You ----------

/** The owner's own life: energy, home and car. */
export function youWindow(rerender: () => void): HTMLElement {
  const s = session.state;
  const home = homeOf(s);
  const car = carOf(s);
  const P = CORPORATE.player;
  const option = (title: string, current: boolean, lines: string[], action: HTMLElement | false): HTMLElement => h('div.person', { class: current ? 'running' : '' }, h('div.head', h('span', { style: { fontWeight: '600' } }, title), current && h('span.good', 'Yours')), ...lines.map((l) => h('div.sub', { style: { marginBottom: '2px' } }, l)), action && h('div.line', h('span', { style: { flex: '1' } }), action));

  return h(
    'div.scroll',
    h(
      'div.bigstats',
      h('div', { tip: 'Working a till yourself wears you out. You recover whenever you are not behind one; a better home makes that faster.' }, h('div.label', 'Energy'), h('div.value', { class: isTired(s) ? 'warn' : '' }, `${Math.round(s.player.energy)} / ${home.maxEnergy}`), h('div.meter', h('div', { style: { width: `${(s.player.energy / home.maxEnergy) * 100}%`, background: isTired(s) ? 'var(--warn)' : 'var(--info)' } }))),
      h('div', h('div.label', 'Right now'), h('div.value', { style: { fontSize: '15px' } }, s.ownerAt ? `Working a till at ${s.shops.find((sh) => sh.id === s.ownerAt!.shopId)?.name ?? 'a shop'}` : 'Resting'), h('div.dim', { style: { fontSize: '12px' } }, s.ownerAt ? `−${P.drainPerHourAtTill} energy an hour` : `+${home.restPerHour} energy an hour`)),
      h('div', { tip: 'Calling in on a shop lifts its staff, tidies it up and nudges its reputation. Open a shop and use "Visit in person".' }, h('div.label', 'Visits left today'), h('div.value', `${visitsLeft(s)}`), h('div.dim', { style: { fontSize: '12px' } }, `${car.visitEnergy} energy each`)),
    ),
    h('div.kv', h('span.k', 'Cost of living'), h('span.v', `${money(home.costPerDay + car.costPerDay)} / day`)),
    isTired(s) && h('div.warn', { style: { fontSize: '13px', margin: '4px 0' } }, `You are worn out: you serve at ${Math.round(P.tiredSpeed * 100)}% speed until you rest.`),
    h('div.section', 'Home'),
    ...Object.entries(P.homes).map(([id, d]) =>
      option(d.name, id === s.player.home, [d.description, `${money(d.costPerDay)} a day · recover ${d.restPerHour} energy an hour · up to ${d.maxEnergy} energy`], id !== s.player.home && h('button.primary', { disabled: s.money < Math.max(0, d.deposit - home.deposit), onclick: () => { moveHome(s, id); rerender(); } }, d.deposit > home.deposit ? `Move in (${money(d.deposit - home.deposit)} deposit)` : 'Move in')),
    ),
    h('div.section', 'Car'),
    ...Object.entries(P.cars).map(([id, d]) => {
      const cost = d.price - Math.round(car.price * 0.5);
      return option(d.name, id === s.player.car, [d.description, `${d.visitsPerDay} shop visits a day at ${d.visitEnergy} energy each${d.costPerDay ? ` · ${money(d.costPerDay)} a day to run` : ''}`], id !== s.player.car && h('button.primary', { disabled: cost > s.money, onclick: () => { buyCar(s, id); rerender(); } }, d.price === 0 ? `Sell the car (${money(Math.round(car.price * 0.5))} back)` : cost > 0 ? `Buy for ${money(cost)}${car.price ? ' with part exchange' : ''}` : `Swap and get ${money(-cost)} back`));
    }),
  );
}
