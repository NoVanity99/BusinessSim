import { bus } from '../../core/events';
import { money } from '../../core/format';
import { session, shopOnLot } from '../../core/state';
import { selectLot } from '../../core/uiState';
import { createShop, setupCost } from '../../systems/build/build';
import { NEIGHBORHOODS, SHOP_TYPES } from '../../data';
import { buyLot, depositOf, priceOf, releaseLot, rentLot, rentOf, RESALE_SHARE } from '../../systems/economy/property';
import { h, setChildren } from '../dom';
import { buyOut, buyoutPrice, companyOf, competitorOf, rivalOnLot, rivalOpenNow, rivalPrice } from '../../systems/rivals/rivals';
import { priceIndex } from '../../systems/ai/residents';
import { dayOf } from '../../systems/time/clock';
import { LOGISTICS, RIVALS } from '../../data';
import { franchiseOnLot, inspect, revoke, royaltyOf } from '../../systems/logistics/franchise';

const meter = (value: number, max: number, color: string): HTMLElement =>
  h('div.meter', h('div', { style: { width: `${Math.min(100, (value / max) * 100)}%`, background: color } }));

/** Details and actions for the selected lot. Re-renders itself on relevant events. */
export function LotPanel(): { el: HTMLElement; destroy(): void } {
  const el = h('div.panel.lot-panel', { style: { display: 'none' } });
  let lotId: number | null = null;

  let lastKey = '';
  const affordKey = (): string => {
    if (lotId === null) return '';
    const s = session.state;
    const lot = session.city.lots[lotId];
    if (franchiseOnLot(s, lot.id)) return `f${s.money >= LOGISTICS.franchise.inspectionCost}`;
    const rival = rivalOnLot(s, lot.id);
    if (rival) return `r${s.money >= buyoutPrice(s, rival)}`;
    return `${s.money >= depositOf(s, lot)}|${s.money >= priceOf(s, lot)}|${Object.keys(SHOP_TYPES).map((id) => s.money >= setupCost(s, lot, id)).join()}`;
  };

  const render = (): void => {
    lastKey = affordKey();
    // Once a business exists the shop panel takes over.
    if (lotId === null || shopOnLot(session.state, lotId)) {
      el.style.display = 'none';
      return;
    }
    const s = session.state;
    const lot = session.city.lots[lotId];
    const n = NEIGHBORHOODS[lot.district];
    const franchise = franchiseOnLot(s, lot.id);
    if (franchise) {
      el.style.display = 'block';
      setChildren(
        el,
        h('h3', h('span', franchise.name), h('button.close', { onclick: () => selectLot(null), tip: 'Close (Esc)' }, '×')),
        h('div.sub', h('span.tag', { style: { background: 'var(--accent)' } }, 'Your franchise'), `  ${SHOP_TYPES[franchise.type].name} · ${n.name}`),
        h('div.sub', `Run by ${franchise.owner} since day ${franchise.openedDay}.`),
        h('div.kv', { tip: 'How well it is run. Standards slip if left alone; poor ones hurt the reputation of your own shops of this kind.' }, h('span.k', 'Standards'), h('span.v', { class: franchise.quality < 38 ? 'bad' : franchise.quality > 72 ? 'good' : '' }, `${Math.round(franchise.quality)}%`)),
        meter(franchise.quality, 100, 'var(--accent)'),
        h('div.kv', h('span.k', 'Customers yesterday'), h('span.v', `${franchise.yesterday}`)),
        h('div.kv', { tip: `${Math.round(LOGISTICS.franchise.royalty * 100)}% of its takings, paid to you every morning.` }, h('span.k', 'Royalty'), h('span.v', `${money(Math.round(royaltyOf(franchise)))} / day`)),
        h(
          'div.actions',
          h('button', { disabled: s.money < LOGISTICS.franchise.inspectionCost, onclick: () => inspect(s, franchise), tip: 'Send someone from head office to raise standards.' }, `Send an inspector (${money(LOGISTICS.franchise.inspectionCost)})`),
          h('button.danger', { onclick: () => { if (confirm(`Withdraw the franchise from ${franchise.owner}? The shop closes and the royalties stop.`)) revoke(s, franchise); } }, 'Withdraw the franchise'),
        ),
      );
      return;
    }
    const rival = rivalOnLot(s, lot.id);
    if (rival) {
      const company = companyOf(s, rival);
      const price = rivalPrice(s, rival);
      const mine = competitorOf(s, rival);
      const cost = buyoutPrice(s, rival);
      const pct = (v: number): string => `${v >= 1 ? '+' : ''}${Math.round((v - 1) * 100)}%`;
      el.style.display = 'block';
      setChildren(
        el,
        h('h3', h('span', rival.name), h('button.close', { onclick: () => selectLot(null), tip: 'Close (Esc)' }, '×')),
        h('div.sub', h('span.tag', { style: { background: company.color, color: '#fff' } }, company.name), `  ${SHOP_TYPES[rival.type].name} · ${n.name}`),
        h('div.sub', rivalOpenNow(s) ? `Open until ${RIVALS.hours[1]}:00` : `Closed. Opens at ${RIVALS.hours[0]}:00`),
        h('div.kv', { tip: 'Their prices against the going market rate. Price-conscious shoppers compare before they choose.' }, h('span.k', 'Prices'), h('span.v', { class: price < 0.97 ? 'bad' : '' }, `${pct(price)} vs market${rival.saleUntil >= dayOf(s.time) ? ' (sale on)' : ''}`)),
        mine && h('div.kv', { tip: `Your ${mine.name} competes with this shop for the same customers.` }, h('span.k', `Your ${mine.name}`), h('span.v', { class: priceIndex(s, mine) <= price ? 'good' : 'warn' }, `${pct(priceIndex(s, mine))} vs market`)),
        h('div.kv', { tip: 'How good the place is. Compare with the reputation of your own shop.' }, h('span.k', 'Quality'), h('span.v', `${Math.round(rival.quality)}%`)),
        meter(rival.quality, 100, company.color),
        mine && h('div.kv', h('span.k', `${mine.name} reputation`), h('span.v', `${Math.round(mine.reputation)}%`)),
        h('div.kv', { tip: 'Residents who chose this shop. People who pick it are not coming to you.' }, h('span.k', 'Customers yesterday'), h('span.v', `${rival.yesterday}`)),
        h('div.kv', { tip: 'A shop that keeps losing money closes after a while. Beat it on price and reputation and it will not last.' }, h('span.k', 'Doing'), h('span.v', { class: rival.profitAvg < 0 ? 'good' : '' }, rival.profitAvg < -20 ? 'Losing money' : rival.profitAvg < 25 ? 'Scraping by' : 'Making money')),
        h('div.note', mine ? 'Undercut them or out-class them and they lose customers; they may cut prices in reply.' : 'You have no shop of this kind nearby, so they are not taking your customers.'),
        h('div.actions', h('button', { disabled: s.money < cost, onclick: () => buyOut(s, rival), tip: 'Pay the company to close this shop. The lot becomes free to rent.' }, `Buy them out (${money(cost)})`)),
      );
      return;
    }
    const own = s.lots[lot.id];
    const rent = rentOf(s, lot);
    const price = priceOf(s, lot);
    const deposit = depositOf(s, lot);
    const businesses = own
      ? Object.entries(SHOP_TYPES).map(([id, t]) => {
          const cost = setupCost(s, lot, id);
          const tooSmall = lot.w * lot.h < t.minArea;
          const locked = s.level < t.unlockLevel;
          return h(
            'button.primary',
            {
              disabled: locked || tooSmall || s.money < cost,
              class: locked ? 'locked' : '',
              tip: `${t.description}\n\nIncludes the licence, a floor, outer walls and a door.${tooSmall ? `\nNeeds at least ${t.minArea} tiles.` : ''}`,
              onclick: () => createShop(s, lot, id),
            },
            locked ? `${t.name} (level ${t.unlockLevel})` : `Open ${t.name} (${money(cost)})`,
          );
        })
      : [];
    const status = own ? (own.owner === 'owned' ? 'Owned by you' : 'Leased by you') : 'Available';

    el.style.display = 'block';
    setChildren(
      el,
      h('h3', h('span', `Lot #${lot.id}`), h('button.close', { onclick: () => selectLot(null), tip: 'Close (Esc)' }, '×')),
      h('div.sub', h('span.tag', { style: { background: n.color } }, n.name), `  ${lot.w} × ${lot.h} tiles · ${status}`),
      h('div.sub', n.description),
      h('div.kv', { tip: 'How many people walk past. More traffic means more potential customers.' }, h('span.k', 'Foot traffic'), h('span.v', `${n.footTraffic.toFixed(2)}×`)),
      meter(n.footTraffic, 1.6, 'var(--info)'),
      h('div.kv', { tip: 'How much locals can spend and how much markup they tolerate.' }, h('span.k', 'Customer wealth'), h('span.v', `${n.wealth.toFixed(2)}×`)),
      meter(n.wealth, 1.6, 'var(--money)'),
      h('div.kv', h('span.k', 'Rent'), h('span.v', `${money(rent)} / day`)),
      !own && h('div.kv', { tip: 'Paid when you sign. Returned when you end the lease.' }, h('span.k', 'Deposit'), h('span.v', money(deposit))),
      own?.owner !== 'owned' && h('div.kv', { tip: 'Buy the lot outright and never pay rent on it again.' }, h('span.k', 'Purchase price'), h('span.v', money(price))),
      own && h('div.actions', ...businesses),
      h(
        'div.actions',
        !own && h('button.primary', { disabled: s.money < deposit, onclick: () => rentLot(s, lot), tip: `Pay a ${money(deposit)} deposit, then ${money(rent)} every midnight.` }, `Rent (${money(deposit)} deposit)`),
        own?.owner !== 'owned' && h('button', { disabled: s.money < price, onclick: () => buyLot(s, lot) }, `Buy for ${money(price)}`),
        own?.owner === 'rented' && h('button.danger', { onclick: () => releaseLot(s, lot), tip: 'Your deposit is returned.' }, 'End lease'),
        own?.owner === 'owned' && h('button.danger', { onclick: () => releaseLot(s, lot), tip: `You get back ${Math.round(RESALE_SHARE * 100)}% of what you paid.` }, `Sell for ${money(Math.round((own.paid ?? price) * RESALE_SHARE))}`),
      ),
    );
  };

  const offs = [
    bus.on('lot:selected', (id) => {
      lotId = id;
      render();
    }),
    bus.on('lot:changed', render),
    bus.on('rivals:changed', render),
    bus.on('shop:removed', render),
    bus.on('level:up', render),
    // Re-render only when cash crosses a threshold, so buttons are not replaced mid-click.
    bus.on('money:changed', () => {
      const key = affordKey();
      if (key !== lastKey) render();
    }),
  ];
  return { el, destroy: () => offs.forEach((off) => off()) };
}
