import { bus } from '../../core/events';
import { money } from '../../core/format';
import { session, shopById } from '../../core/state';
import { selectObject, setTool, ui } from '../../core/uiState';
import { PRODUCTS, SHOP_TYPES } from '../../data';
import { batchQty, defOf } from '../../entities/Shop';
import { sellObject, sellValue } from '../../systems/build/build';
import { assignSlot, fillObject, fillSlot, freshnessDays, slotAccepts } from '../../systems/economy/stock';
import { h, setChildren } from '../dom';

/** Details for the selected piece of furniture: shelf contents, checkout operator, move/sell. */
export function ObjectPanel(): { el: HTMLElement; destroy(): void } {
  const el = h('div.panel.object-panel', { style: { display: 'none' } });
  let pending = false;

  const render = (): void => {
    pending = false;
    const sel = ui.selectedObject;
    const s = session.state;
    const shop = sel ? shopById(s, sel.shopId) : undefined;
    const obj = shop?.objects.find((o) => o.id === sel?.objectId);
    if (!shop || !obj) {
      el.style.display = 'none';
      return;
    }
    // Leave an open dropdown alone; rebuilding it would close it under the cursor.
    if (el.contains(document.activeElement) && document.activeElement?.tagName === 'SELECT') return;
    const def = defOf(obj);
    el.style.display = 'block';

    const slots = (obj.slots ?? []).map((slot, i) => {
      const options = SHOP_TYPES[shop.type].products.filter((p) => slotAccepts(obj, p));
      const select = h(
        'select',
        { onchange: (e: Event) => assignSlot(shop, obj, i, (e.target as HTMLSelectElement).value || null), tip: 'What this section of the shelf displays. Changing it sends the current contents back to storage.' },
        h('option', { value: '' }, '(empty)'),
        ...options.map((p) => h('option', { value: p, selected: slot.product === p }, PRODUCTS[p].name)),
      );
      const qty = batchQty(slot.batches);
      const cap = def.slotCapacity ?? 0;
      const inStore = slot.product ? batchQty(shop.storage[slot.product]) : 0;
      const fresh = freshnessDays(s, slot.batches);
      return h(
        'div.slot',
        h('div.row', select, h('button', { disabled: !slot.product || qty >= cap || inStore <= 0, onclick: () => fillSlot(shop, obj, i), tip: 'Move stock from the back room onto this shelf.' }, 'Fill')),
        slot.product &&
          h(
            'div.kv',
            { style: { marginTop: '6px' } },
            h('span.k', `On shelf ${qty} / ${cap}`),
            h('span.v', { class: inStore ? '' : 'warn' }, `${inStore} in storage`),
          ),
        slot.product && fresh !== null && h('div.kv', h('span.k', 'Freshness'), h('span.v', { class: fresh <= 1 ? 'warn' : '' }, fresh <= 0 ? 'expires tonight' : `${fresh} day${fresh === 1 ? '' : 's'} left`)),
      );
    });

    const ownerHere = s.ownerAt?.shopId === shop.id && s.ownerAt.objectId === obj.id;
    setChildren(
      el,
      h('h3', h('span', def.name), h('button.close', { onclick: () => selectObject(null) }, '×')),
      h('div.sub', def.description),
      ...slots,
      obj.slots && h('div.actions', h('button.primary', { onclick: () => fillObject(shop, obj), tip: 'Fill every section from the back room.' }, 'Fill all sections')),
      def.kind === 'register' &&
        h(
          'div',
          h('div.kv', h('span.k', 'Operator'), h('span.v', { class: ownerHere ? 'good' : 'warn' }, ownerHere ? 'You (owner)' : 'Nobody')),
          h(
            'div.actions',
            h(
              'button',
              {
                disabled: ownerHere,
                tip: 'You can personally run one checkout in the whole city. Hire cashiers for the rest.',
                onclick: () => {
                  const prev = s.ownerAt;
                  s.ownerAt = { shopId: shop.id, objectId: obj.id };
                  if (prev) bus.emit('shop:changed', prev.shopId);
                  bus.emit('shop:changed', shop.id);
                },
              },
              'Work this checkout yourself',
            ),
          ),
        ),
      h(
        'div.actions',
        h('div.row', h('button', { style: { flex: '1' }, onclick: () => setTool({ type: 'place', def: obj.def, rot: obj.rot, movingId: obj.id }), tip: 'Pick it up and put it somewhere else. Press R to rotate.' }, 'Move'),
          h('button.danger', { style: { flex: '1' }, onclick: () => { selectObject(null); sellObject(s, shop, obj); }, tip: 'Contents go back to storage.' }, `Sell (${money(sellValue(s, obj.def))})`)),
      ),
    );
  };

  const schedule = (): void => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      // Do not swap buttons out from under a click in progress.
      if (el.querySelector(':active')) {
        pending = false;
        setTimeout(schedule, 120);
      } else render();
    });
  };
  const offs = [bus.on('object:selected', render), bus.on('stock:changed', schedule), bus.on('shop:changed', schedule), bus.on('shop:removed', schedule)];
  return { el, destroy: () => offs.forEach((off) => off()) };
}
