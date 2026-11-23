import { describe, expect, it } from 'vitest';
import { session } from '../src/core/state';
import { batchQty } from '../src/entities/Shop';
import { createShop, placeObject, sellObject, sellValue, buildCost } from '../src/systems/build/build';
import { canRedo, canUndo, record, redo, snapOf, undo } from '../src/systems/build/history';
import { applyTemplate, previewTemplate, templatesFor } from '../src/systems/build/templates';
import { rentLot } from '../src/systems/economy/property';
import { addToStorage, assignSlot, fillObject } from '../src/systems/economy/stock';
import { SHOP_TYPES } from '../src/data';
import { findLot, startGame } from './helpers';

function emptyShop(type = 'convenience') {
  const s = session.state;
  const lot = findLot(type, 'downtown');
  rentLot(s, lot);
  return { shop: createShop(s, lot, type)!, lot };
}

describe('build history', () => {
  it('undoes and redoes a purchase with a full refund, keeping the same piece', () => {
    const s = startGame();
    const { shop, lot } = emptyShop();
    const cash = s.money;
    const obj = placeObject(s, shop, lot, 'shelf', lot.x + 1, lot.y + 1, 0)!;
    record(shop.id, { t: 'place', obj: snapOf(obj), cost: cash - s.money });
    expect(s.money).toBe(cash - buildCost(s, 'shelf'));
    expect(undo(shop.id)).toBe(true);
    expect(shop.objects.length).toBe(0);
    expect(s.money).toBe(cash);
    expect(canRedo(shop.id)).toBe(true);
    expect(redo(shop.id)).toBe(true);
    expect(shop.objects[0].id).toBe(obj.id);
    expect(s.money).toBe(cash - buildCost(s, 'shelf'));
  });

  it('undoing a sale buys the piece back with its shelf labels, and stock is never lost', () => {
    const s = startGame();
    const { shop, lot } = emptyShop();
    const obj = placeObject(s, shop, lot, 'shelf', lot.x + 1, lot.y + 1, 0)!;
    addToStorage(shop, 'chips', 40, 0);
    assignSlot(shop, obj, 0, 'chips');
    fillObject(shop, obj);
    const onShelf = batchQty(obj.slots![0].batches);
    expect(onShelf).toBeGreaterThan(0);
    const cash = s.money;
    const snap = snapOf(obj);
    sellObject(s, shop, obj);
    record(shop.id, { t: 'sell', obj: snap, value: sellValue(s, 'shelf') });
    expect(batchQty(shop.storage.chips)).toBe(40);
    expect(undo(shop.id)).toBe(true);
    expect(s.money).toBe(cash);
    expect(shop.objects[0].slots![0].product).toBe('chips');
    expect(canUndo(shop.id)).toBe(false);
  });

  it('refuses to undo when something is in the way, and keeps the step', () => {
    const s = startGame();
    const { shop, lot } = emptyShop();
    const obj = placeObject(s, shop, lot, 'shelf', lot.x + 1, lot.y + 1, 0)!;
    const snap = snapOf(obj);
    sellObject(s, shop, obj);
    record(shop.id, { t: 'sell', obj: snap, value: sellValue(s, 'shelf') });
    placeObject(s, shop, lot, 'register', lot.x + 1, lot.y + 1, 0);
    expect(undo(shop.id)).toBe(false);
    expect(canUndo(shop.id)).toBe(true);
  });
});

describe('layout templates', () => {
  it('every business with a starter layout can build all of it, and one undo removes it', () => {
    const s = startGame();
    for (const type of Object.keys(SHOP_TYPES)) {
      const starter = templatesFor(type).find((t) => t.builtIn);
      if (!starter) continue;
      const { shop } = emptyShop(type);
      const cash = s.money;
      const pv = previewTemplate(s, shop, starter);
      expect(pv.fits, `${type} starter fits`).toBe(pv.total);
      expect(applyTemplate(s, shop, starter)).toBe(starter.items.length);
      expect(s.money).toBe(cash - pv.cost);
      expect(undo(shop.id)).toBe(true);
      expect(shop.objects.length).toBe(0);
      expect(s.money).toBe(cash);
    }
  });

  it('mirrors a layout onto a lot that faces the other way', () => {
    const s = startGame();
    const lot = session.city.lots.find((l) => l.rentable && l.front === 'n' && l.w >= 8 && l.w * l.h >= 64)!;
    rentLot(s, lot);
    const shop = createShop(s, lot, 'convenience')!;
    const starter = templatesFor('convenience')[0];
    expect(applyTemplate(s, shop, starter)).toBe(starter.items.length);
    // The till was near the front (south) in the template; here the front is north.
    const till = shop.objects.find((o) => o.def === 'register')!;
    const shelf = shop.objects.find((o) => o.def === 'shelf')!;
    expect(till.y).toBeLessThan(shelf.y);
    expect(shelf.slots![0].product).toBe('chips');
  });
});
