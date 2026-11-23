import Phaser from 'phaser';
import { furnitureTexture } from '../../art/sprites';
import { TILE } from '../../core/constants';
import { bus, toast } from '../../core/events';
import { session, shopOnLot } from '../../core/state';
import { selectObject, setTool, ui } from '../../core/uiState';
import { FURNITURE } from '../../data';
import { footprint, frontTiles, inLot, lotIndex, objectAt, WALL_NONE, type ShopState } from '../../entities/Shop';
import { buildCost, checkPlace, moveObject, paintStructure, placeObject, removeWall, sellObject } from '../../systems/build/build';
import type { LotDef } from '../../systems/city/generate';
import { DEPTH } from './ShopViews';
import { sfx } from '../../systems/audio/audio';

const isStructure = (defId: string): boolean => FURNITURE[defId].category === 'structure';

/** Handles pointer input while a build tool is active and draws the placement ghost. */
export class BuildTool {
  private ghost: Phaser.GameObjects.Image;
  private gfx: Phaser.GameObjects.Graphics;
  private tile = { x: -1, y: -1 };
  private painting = false;
  private painted = false;

  constructor(private scene: Phaser.Scene) {
    this.ghost = scene.add.image(0, 0, '__DEFAULT').setDepth(DEPTH.ghost).setVisible(false).setAlpha(0.75);
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
    setTool(null);
  }

  onMove(tx: number, ty: number, isDown: boolean): void {
    if (tx === this.tile.x && ty === this.tile.y) return;
    this.tile = { x: tx, y: ty };
    if (isDown && this.painting) this.paintAt(tx, ty);
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
        if (obj) moveObject(shop, lot, obj, x, y, t.rot);
        setTool({ type: 'move' });
      } else {
        if (placeObject(s, shop, lot, t.def, x, y, t.rot)) sfx('place');
      }
      this.refresh();
      return;
    }

    const obj = objectAt(shop, tx, ty);
    if (t.type === 'move') {
      if (obj) setTool({ type: 'place', def: obj.def, rot: obj.rot, movingId: obj.id });
      return;
    }
    // Sell tool: furniture first, otherwise the wall or door on that tile.
    if (obj) {
      if (ui.selectedObject?.objectId === obj.id) selectObject(null);
      sellObject(s, shop, obj);
      sfx('sell');
    } else if (removeWall(s, shop, lot, tx, ty)) {
      bus.emit('shop:changed', shop.id);
    }
    this.refresh();
  }

  onUp(): void {
    if (this.painting && this.painted) {
      const ctx = this.context();
      if (ctx) bus.emit('shop:changed', ctx.shop.id);
    }
    this.painting = false;
  }

  private paintAt(tx: number, ty: number): void {
    const ctx = this.context();
    const t = ui.tool;
    if (!ctx || t?.type !== 'place') return;
    if (paintStructure(session.state, ctx.shop, ctx.lot, t.def, tx, ty)) {
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
      g.fillStyle(ok ? 0x4fc3a1 : 0xe5605a, 0.45).fillRect(tx * TILE, ty * TILE, TILE, TILE);
      g.lineStyle(2, ok ? 0x4fc3a1 : 0xe5605a, 1).strokeRect(tx * TILE, ty * TILE, TILE, TILE);
      return;
    }

    if (t.type === 'place') {
      const { x, y } = this.anchor(t.def, t.rot);
      const { w, h } = footprint(t.def, t.rot);
      const ok = checkPlace(shop, lot, t.def, x, y, t.rot, t.movingId).ok;
      const color = ok ? 0x4fc3a1 : 0xe5605a;
      this.ghost
        .setTexture(furnitureTexture(this.scene, t.def))
        .setPosition((x + w / 2) * TILE, (y + h / 2) * TILE)
        .setAngle(t.rot * 90)
        .setTint(ok ? 0xffffff : 0xff8888)
        .setVisible(true);
      g.lineStyle(2, color, 1).strokeRect(x * TILE, y * TILE, w * TILE, h * TILE);
      // Mark where customers will stand, and warn if that spot is blocked.
      const kind = FURNITURE[t.def].kind;
      if (kind === 'shelf' || kind === 'register') {
        for (const f of frontTiles({ def: t.def, x, y, rot: t.rot })) {
          const blocked = !inLot(lot, f.x, f.y) || shop.wall[lotIndex(lot, f.x, f.y)] !== WALL_NONE || !!objectAt(shop, f.x, f.y);
          g.fillStyle(blocked ? 0xe5605a : 0xf2d24b, 0.35).fillRect(f.x * TILE + 6, f.y * TILE + 6, TILE - 12, TILE - 12);
        }
      }
      return;
    }

    const obj = objectAt(shop, tx, ty);
    const color = t.type === 'sell' ? 0xe5605a : 0x5aa9e6;
    if (obj) {
      const { w, h } = footprint(obj.def, obj.rot);
      g.fillStyle(color, 0.3).fillRect(obj.x * TILE, obj.y * TILE, w * TILE, h * TILE);
      g.lineStyle(2, color, 1).strokeRect(obj.x * TILE, obj.y * TILE, w * TILE, h * TILE);
    } else if (t.type === 'sell' && inLot(lot, tx, ty) && shop.wall[lotIndex(lot, tx, ty)] !== WALL_NONE) {
      g.fillStyle(color, 0.4).fillRect(tx * TILE, ty * TILE, TILE, TILE);
    }
  }
}
