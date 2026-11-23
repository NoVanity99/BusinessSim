import { describe, expect, it } from 'vitest';
import { session } from '../src/core/state';
import { batchQty } from '../src/entities/Shop';
import { closeShop, createShop, placeObject, sellObject, sellValue, buildCost } from '../src/systems/build/build';
import { doors, footprint, frontTiles, inLot } from '../src/entities/Shop';
import { rt } from '../src/systems/ai/runtime';
import { FURNITURE } from '../src/data';
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
    for (const type of Object.keys(SHOP_TYPES)) {
      const starter = templatesFor(type).find((t) => t.builtIn);
      if (!starter) continue;
      // A fresh city each time: there are more kinds of business than big empty lots.
      const s = startGame();
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

describe('starter layouts', () => {
  it('leave every checkout, shelf, machine and seat reachable from the door, on every lot they fit', () => {
    const problems: string[] = [];
    for (const type of Object.keys(SHOP_TYPES)) {
      const starter = templatesFor(type).find((t) => t.builtIn);
      if (!starter) continue;
      const s = startGame(50_000_000);
      const lots = session.city.lots.filter((l) => l.rentable && l.w * l.h >= SHOP_TYPES[type].minArea);
      for (const lot of lots) {
        if (!rentLot(s, lot)) continue;
        const shop = createShop(s, lot, type);
        if (!shop) continue;
        applyTemplate(s, shop, starter);
        const g = rt.grid;
        const door = doors(shop, lot)[0];
        // Flood out from the door over walkable tiles.
        const seen = new Set<number>([door.y * g.w + door.x]);
        const queue = [door.y * g.w + door.x];
        while (queue.length) {
          const t = queue.pop()!;
          for (const n of [t - 1, t + 1, t - g.w, t + g.w]) {
            const x = n % g.w;
            const y = Math.floor(n / g.w);
            if (seen.has(n) || !inLot(lot, x, y) || !g.cost[n]) continue;
            seen.add(n);
            queue.push(n);
          }
        }
        for (const o of shop.objects) {
          const d = FURNITURE[o.def];
          if (d.anywhere) continue;
          // Things used from the front need their front tile; everything else needs any side.
          const fronted = d.kind === 'shelf' || d.kind === 'register';
          const { w, h } = footprint(o.def, o.rot);
          const around: number[] = [];
          for (let x = o.x - 1; x <= o.x + w; x++) for (let y = o.y - 1; y <= o.y + h; y++) if ((x < o.x || x >= o.x + w) !== (y < o.y || y >= o.y + h)) around.push(y * g.w + x);
          const access = fronted ? frontTiles(o).map((t) => t.y * g.w + t.x) : around;
          if (!access.some((t) => seen.has(t))) problems.push(`${type}: ${o.def} cannot be reached on a ${lot.w}x${lot.h} lot facing ${lot.front}`);
        }
        // Businesses with a forecourt lay out differently on deep lots; they are only checked for access.
        if (!SHOP_TYPES[type].shellDepth && starter.items.length !== shop.objects.length && lot.w >= 8 && lot.h >= 8) problems.push(`${type}: only ${shop.objects.length}/${starter.items.length} pieces fit a ${lot.w}x${lot.h} lot facing ${lot.front}`);
        closeShop(s, shop);
      }
    }
    expect([...new Set(problems)]).toEqual([]);
  }, 120_000);
});
