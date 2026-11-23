import { bus } from '../../core/events';
import { money } from '../../core/format';
import { session, shopOnLot } from '../../core/state';
import { selectLot } from '../../core/uiState';
import { createShop, setupCost } from '../../systems/build/build';
import { NEIGHBORHOODS, SHOP_TYPES } from '../../data';
import { buyLot, depositOf, priceOf, releaseLot, rentLot, rentOf, RESALE_SHARE } from '../../systems/economy/property';
import { h, setChildren } from '../dom';

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
