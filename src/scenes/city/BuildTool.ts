import Phaser from 'phaser';
import { signal } from '../../core/settings';
import { ATLAS, SCALE } from '../../art/atlas';
import { furnFrame } from '../../art/furnitureArt';
import { TILE } from '../../core/constants';
import { bus, toast } from '../../core/events';
import { session, shopOnLot } from '../../core/state';
import { selectObject, setTool, ui } from '../../core/uiState';
import { FURNITURE } from '../../data';
import { footprint, frontTiles, inLot, lotIndex, objectAt, WALL_NONE, type ShopState } from '../../entities/Shop';
import { buildCost, checkPlace, moveObject, paintStructure, placeObject, removeWall, sellObject } from '../../systems/build/build';
import type { LotDef } from '../../systems/city/generate';
import { DEPTH } from './ShopViews';
import { record, snapOf, type Op } from '../../systems/build/history';
import { assignSlot } from '../../systems/economy/stock';
import { sellValue } from '../../systems/build/build';
import { sfx } from '../../systems/audio/audio';

const isStructure = (defId: string): boolean => FURNITURE[defId].category === 'structure';

/** Handles pointer input while a build tool is active and draws the placement ghost. */
export class BuildTool {
  private ghost: Phaser.GameObjects.Image;
  private gfx: Phaser.GameObjects.Graphics;
  private tile = { x: -1, y: -1 };
  private painting = false;
  private painted = false;
  /** Tiles changed and money spent during the current drag, for one undo step. */
  private stroke: { tiles: Map<number, { i: number; f0: string; w0: number; f1: string; w1: number }>; cost: number } = { tiles: new Map(), cost: 0 };
  /** Where a drag to place a row of furniture began (anchor tile), or null. */
  private rowStart: { x: number; y: number } | null = null;

  constructor(scene: Phaser.Scene) {
    this.ghost = scene.add.image(0, 0, ATLAS, 'wall').setOrigin(0).setScale(SCALE).setDepth(DEPTH.ghost).setVisible(false).setAlpha(0.8);
    this.gfx = scene.add.graphics().setDepth(DEPTH.ghost);
    bus.on('tool:changed', () => this.refresh());
  }

  get active(): boolean {
    return ui.tool !== null;
  }

  private context(): { shop: ShopState; lot: LotDef } | null {
    if (ui.selectedLot === null) return null;
    const shop = shopOnLot(session.state, ui.selectedLot);
    return shop ? { shop, lot: session.city.lots[shop.lotId] } : null;
  }

  rotate(): void {
    const t = ui.tool;
    if (t?.type !== 'place' || isStructure(t.def)) return;
    t.rot = (t.rot + 1) % 4;
    this.refresh();
  }

  cancel(): void {
    this.painting = false;
    this.rowStart = null;
    setTool(null);
  }

  onMove(tx: number, ty: number, isDown: boolean): void {
    if (tx === this.tile.x && ty === this.tile.y) return;
    this.tile = { x: tx, y: ty };
    if (isDown && this.painting) this.paintAt(tx, ty);
    if (!isDown) this.rowStart = null;
    this.refresh();
  }

  onDown(tx: number, ty: number): void {
    this.tile = { x: tx, y: ty };
    const ctx = this.context();
    const t = ui.tool;
    if (!ctx || !t) return;
    const { shop, lot } = ctx;
    const s = session.state;

    if (t.type === 'place') {
      if (isStructure(t.def)) {
        this.painting = true;
        this.painted = false;
        this.paintAt(tx, ty);
        return;
      }
      const { x, y } = this.anchor(t.def, t.rot);
      const check = checkPlace(shop, lot, t.def, x, y, t.rot, t.movingId);
      if (!check.ok) {
        toast(check.reason, 'warn');
        return;
      }
      if (t.movingId !== undefined) {
        const obj = shop.objects.find((o) => o.id === t.movingId);
        if (obj) {
          const from = { x: obj.x, y: obj.y, rot: obj.rot };
          if (moveObject(shop, lot, obj, x, y, t.rot)) record(shop.id, { t: 'move', id: obj.id, from, to: { x, y, rot: t.rot } });
        }
        setTool({ type: 'move' });
        this.refresh();
        return;
      }
      // Furniture is placed on release, so a drag can lay out a whole row.
      this.rowStart = { x, y };
      this.refresh();
      return;
    }

    const obj = objectAt(shop, tx, ty);
    if (t.type === 'move') {
      if (obj) setTool({ type: 'place', def: obj.def, rot: obj.rot, movingId: obj.id });
      return;
    }
    if (t.type === 'copy') {
      // Pick up a copy of whatever was clicked, shelf assignments included.
      if (obj) setTool({ type: 'place', def: obj.def, rot: obj.rot, products: obj.slots?.map((sl) => sl.product) });
      return;
    }
    // Sell tool: furniture first, otherwise the wall or door on that tile.
    if (obj) {
      if (ui.selectedObject?.objectId === obj.id) selectObject(null);
      const snap = snapOf(obj);
      sellObject(s, shop, obj);
      record(shop.id, { t: 'sell', obj: snap, value: sellValue(s, snap.def) });
      sfx('sell');
    } else if (inLot(lot, tx, ty)) {
      const i = lotIndex(lot, tx, ty);
      const before = shop.wall[i];
      const cash = s.money;
      if (removeWall(s, shop, lot, tx, ty)) {
        record(shop.id, { t: 'paint', tiles: [{ i, f0: shop.floor[i], w0: before, f1: shop.floor[i], w1: shop.wall[i] }], cost: cash - s.money });
        bus.emit('shop:changed', shop.id);
      }
    }
    this.refresh();
  }

  onUp(): void {
    const ctx = this.context();
    if (this.painting && this.painted && ctx) {
      record(ctx.shop.id, { t: 'paint', tiles: [...this.stroke.tiles.values()], cost: this.stroke.cost });
      bus.emit('shop:changed', ctx.shop.id);
    }
    this.painting = false;
    this.stroke = { tiles: new Map(), cost: 0 };

    const t = ui.tool;
    if (this.rowStart && ctx && t?.type === 'place' && t.movingId === undefined) {
      const { shop, lot } = ctx;
      const s = session.state;
      const ops: Op[] = [];
      for (const p of this.rowTiles(t.def, t.rot)) {
        if (!checkPlace(shop, lot, t.def, p.x, p.y, t.rot).ok) continue;
        const cash = s.money;
        const obj = placeObject(s, shop, lot, t.def, p.x, p.y, t.rot);
        // Out of money: stop rather than toast once per remaining tile.
        if (!obj) break;
        t.products?.forEach((product, i) => product && assignSlot(shop, obj, i, product));
        ops.push({ t: 'place', obj: snapOf(obj), cost: cash - s.money });
        bus.emit('fx', { kind: 'dust', x: p.x, y: p.y });
      }
      if (ops.length) {
        sfx('place');
        record(shop.id, ops.length === 1 ? ops[0] : { t: 'batch', ops, label: `${ops.length} × ${FURNITURE[t.def].name}` });
      } else {
        const first = this.rowTiles(t.def, t.rot)[0];
        const check = checkPlace(shop, lot, t.def, first.x, first.y, t.rot);
        if (!check.ok) toast(check.reason, 'warn');
      }
    }
    this.rowStart = null;
    this.refresh();
  }

  /** Anchor tiles for the row being dragged out: from where the drag began toward the cursor, along one axis. */
  private rowTiles(defId: string, rot: number): { x: number; y: number }[] {
    const end = this.anchor(defId, rot);
    const start = this.rowStart ?? end;
    const { w, h } = footprint(defId, rot);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const alongX = Math.abs(dx) >= Math.abs(dy);
    const stepSize = alongX ? w : h;
    const count = Math.min(24, Math.floor(Math.abs(alongX ? dx : dy) / stepSize) + 1);
    const sign = Math.sign(alongX ? dx : dy) || 1;
    return Array.from({ length: count }, (_v, i) => ({ x: start.x + (alongX ? i * stepSize * sign : 0), y: start.y + (alongX ? 0 : i * stepSize * sign) }));
  }

  private paintAt(tx: number, ty: number): void {
    const ctx = this.context();
    const t = ui.tool;
    if (!ctx || t?.type !== 'place') return;
    const s = session.state;
    const inside = inLot(ctx.lot, tx, ty);
    const i = inside ? lotIndex(ctx.lot, tx, ty) : -1;
    const f0 = inside ? ctx.shop.floor[i] : '';
    const w0 = inside ? ctx.shop.wall[i] : 0;
    const cash = s.money;
    if (paintStructure(s, ctx.shop, ctx.lot, t.def, tx, ty)) {
      const prev = this.stroke.tiles.get(i);
      this.stroke.tiles.set(i, { i, f0: prev?.f0 ?? f0, w0: prev?.w0 ?? w0, f1: ctx.shop.floor[i], w1: ctx.shop.wall[i] });
      this.stroke.cost += cash - s.money;
      this.painted = true;
      sfx('place', 0.5);
      // Show progress while dragging; the walk grid is rebuilt when the drag ends too.
      bus.emit('shop:changed', ctx.shop.id);
    }
  }

  /** Top-left tile of the footprint so the object stays centred under the cursor. */
  private anchor(defId: string, rot: number): { x: number; y: number } {
    const { w, h } = footprint(defId, rot);
    return { x: this.tile.x - Math.floor((w - 1) / 2), y: this.tile.y - Math.floor((h - 1) / 2) };
  }

  /** Redraw the ghost and highlights for the current tool and cursor tile. */
  refresh(): void {
    const g = this.gfx;
    g.clear();
    this.ghost.setVisible(false);
    const t = ui.tool;
    const ctx = this.context();
    if (!t || !ctx || this.tile.x < 0) return;
    const { shop, lot } = ctx;
    const { x: tx, y: ty } = this.tile;

    if (t.type === 'place' && isStructure(t.def)) {
      const ok = inLot(lot, tx, ty) && session.state.money >= buildCost(session.state, t.def);
      const kind = FURNITURE[t.def].kind;
      this.ghost.setFrame(kind === 'floor' ? `floor:${t.def}` : kind === 'door' ? 'door_h' : 'wall').setPosition(tx * TILE, ty * TILE).setTint(ok ? 0xffffff : 0xff8888).setVisible(true);
      g.fillStyle(ok ? signal().good : signal().bad, 0.2).fillRect(tx * TILE, ty * TILE, TILE, TILE);
      g.lineStyle(2, ok ? signal().good : signal().bad, 1).strokeRect(tx * TILE, ty * TILE, TILE, TILE);
      return;
    }

    if (t.type === 'place' && this.rowStart && t.movingId === undefined) {
      // Dragging out a row: outline every spot, green where it will be built.
      const { w, h } = footprint(t.def, t.rot);
      const tiles = this.rowTiles(t.def, t.rot);
      let affordable = Math.floor(session.state.money / Math.max(1, buildCost(session.state, t.def)));
      tiles.forEach((p, n) => {
        const ok = checkPlace(shop, lot, t.def, p.x, p.y, t.rot).ok && affordable-- > 0;
        const color = ok ? signal().good : signal().bad;
        g.fillStyle(color, 0.25).fillRect(p.x * TILE, p.y * TILE, w * TILE, h * TILE);
        g.lineStyle(2, color, 1).strokeRect(p.x * TILE, p.y * TILE, w * TILE, h * TILE);
        if (n === tiles.length - 1) this.ghost.setFrame(furnFrame(t.def, t.rot)).setPosition(p.x * TILE, p.y * TILE).setTint(ok ? 0xbfffe0 : 0xff8888).setVisible(true);
      });
      return;
    }

    if (t.type === 'place') {
      const { x, y } = this.anchor(t.def, t.rot);
      const { w, h } = footprint(t.def, t.rot);
      const ok = checkPlace(shop, lot, t.def, x, y, t.rot, t.movingId).ok;
      const color = ok ? signal().good : signal().bad;
      this.ghost
        .setFrame(furnFrame(t.def, t.rot))
        .setPosition(x * TILE, y * TILE)
        .setTint(ok ? 0xbfffe0 : 0xff8888)
        .setVisible(true);
      g.lineStyle(2, color, 1).strokeRect(x * TILE, y * TILE, w * TILE, h * TILE);
      // Mark where customers will stand, and warn if that spot is blocked.
      const kind = FURNITURE[t.def].kind;
      if (kind === 'shelf' || kind === 'register') {
        for (const f of frontTiles({ def: t.def, x, y, rot: t.rot })) {
          const blocked = !inLot(lot, f.x, f.y) || shop.wall[lotIndex(lot, f.x, f.y)] !== WALL_NONE || !!objectAt(shop, f.x, f.y);
          g.fillStyle(blocked ? signal().bad : 0xf2d24b, 0.35).fillRect(f.x * TILE + 6, f.y * TILE + 6, TILE - 12, TILE - 12);
        }
      }
      return;
    }

    const obj = objectAt(shop, tx, ty);
    const color = t.type === 'sell' ? signal().bad : t.type === 'copy' ? 0xf2b84b : 0x5aa9e6;
    if (obj) {
      const { w, h } = footprint(obj.def, obj.rot);
      g.fillStyle(color, 0.3).fillRect(obj.x * TILE, obj.y * TILE, w * TILE, h * TILE);
      g.lineStyle(2, color, 1).strokeRect(obj.x * TILE, obj.y * TILE, w * TILE, h * TILE);
    } else if (t.type === 'sell' && inLot(lot, tx, ty) && shop.wall[lotIndex(lot, tx, ty)] !== WALL_NONE) {
      g.fillStyle(color, 0.4).fillRect(tx * TILE, ty * TILE, TILE, TILE);
    }
  }
}
