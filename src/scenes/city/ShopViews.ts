import Phaser from 'phaser';
import { drawDoor, drawFloor, drawWall, furnitureTexture } from '../../art/sprites';
import { TILE } from '../../core/constants';
import { session, shopById } from '../../core/state';
import { PRODUCTS } from '../../data';
import { backTile, batchQty, defOf, footprint, WALL_DOOR, WALL_NONE, type ShopState } from '../../entities/Shop';

interface View {
  structure: Phaser.GameObjects.Image;
  objects: Map<number, Phaser.GameObjects.Image>;
  bars: Phaser.GameObjects.Graphics;
}

export const DEPTH = { ground: 0, structure: 1, lots: 2, rug: 3, objects: 10, bars: 11, npcs: 20, ghost: 40, bubbles: 50 };

/** Draws every shop: a baked floor/wall texture, one image per object, and stock-level bars. */
export class ShopViews {
  private views = new Map<number, View>();
  private dirtyBars = new Set<number>();

  constructor(private scene: Phaser.Scene) {}

  /** Rebuild a shop's visuals after any layout change. */
  sync(shopId: number): void {
    const shop = shopById(session.state, shopId);
    if (!shop) return this.remove(shopId);
    const lot = session.city.lots[shop.lotId];
    let v = this.views.get(shopId);
    const key = `shop_struct_${shopId}`;
    if (!v) {
      // A previous session (before a load) may have left this key behind.
      if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
      this.scene.textures.createCanvas(key, lot.w * TILE, lot.h * TILE);
      v = {
        structure: this.scene.add.image(lot.x * TILE, lot.y * TILE, key).setOrigin(0).setDepth(DEPTH.structure),
        objects: new Map(),
        bars: this.scene.add.graphics().setDepth(DEPTH.bars),
      };
      this.views.set(shopId, v);
    }

    const tex = this.scene.textures.get(key) as Phaser.Textures.CanvasTexture;
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, lot.w * TILE, lot.h * TILE);
    const wallAt = (x: number, y: number): number => (x < 0 || y < 0 || x >= lot.w || y >= lot.h ? WALL_NONE : shop.wall[y * lot.w + x]);
    for (let y = 0; y < lot.h; y++) {
      for (let x = 0; x < lot.w; x++) {
        const i = y * lot.w + x;
        if (shop.floor[i]) drawFloor(ctx, shop.floor[i], x * TILE, y * TILE, x, y);
        if (shop.wall[i] === WALL_DOOR) drawDoor(ctx, x * TILE, y * TILE, wallAt(x - 1, y) !== WALL_NONE || wallAt(x + 1, y) !== WALL_NONE);
        else if (shop.wall[i] !== WALL_NONE) drawWall(ctx, x * TILE, y * TILE);
      }
    }
    tex.refresh();

    const seen = new Set<number>();
    for (const o of shop.objects) {
      seen.add(o.id);
      let img = v.objects.get(o.id);
      if (!img) {
        img = this.scene.add.image(0, 0, furnitureTexture(this.scene, o.def));
        v.objects.set(o.id, img);
      }
      const { w, h } = footprint(o.def, o.rot);
      img.setPosition((o.x + w / 2) * TILE, (o.y + h / 2) * TILE);
      img.setAngle(o.rot * 90);
      img.setDepth(defOf(o).walkable ? DEPTH.rug : DEPTH.objects);
    }
    for (const [id, img] of v.objects) {
      if (!seen.has(id)) {
        img.destroy();
        v.objects.delete(id);
      }
    }
    this.drawBars(shop, v);
  }

  remove(shopId: number): void {
    const v = this.views.get(shopId);
    if (!v) return;
    v.structure.destroy();
    v.bars.destroy();
    v.objects.forEach((img) => img.destroy());
    this.scene.textures.remove(`shop_struct_${shopId}`);
    this.views.delete(shopId);
  }

  /** Stock changes can fire many times a frame; redraw bars at most once per frame. */
  markStockDirty(shopId: number): void {
    this.dirtyBars.add(shopId);
  }

  flush(): void {
    if (!this.dirtyBars.size) return;
    for (const id of this.dirtyBars) {
      const shop = shopById(session.state, id);
      const v = this.views.get(id);
      if (shop && v) this.drawBars(shop, v);
    }
    this.dirtyBars.clear();
  }

  objectImage(shopId: number, objectId: number): Phaser.GameObjects.Image | undefined {
    return this.views.get(shopId)?.objects.get(objectId);
  }

  private drawBars(shop: ShopState, v: View): void {
    const g = v.bars;
    g.clear();
    // Litter: the dirtier the shop, the more of it lies around. Positions are fixed per shop so it does not flicker.
    const lot = session.city.lots[shop.lotId];
    const bits = Math.floor(shop.dirt / 7);
    for (let i = 0; i < bits; i++) {
      const tx = (shop.id * 7 + i * 13) % lot.w;
      const ty = (shop.id * 3 + i * 29) % lot.h;
      if (shop.wall[ty * lot.w + tx] !== WALL_NONE || !shop.floor[ty * lot.w + tx]) continue;
      const px = (lot.x + tx) * TILE + 6 + ((i * 11) % 18);
      const py = (lot.y + ty) * TILE + 6 + ((i * 17) % 18);
      g.fillStyle(i % 3 ? 0x7a6a55 : 0xd9d2c0, 0.9).fillRect(px, py, 4, 3);
    }
    for (const o of shop.objects) {
      const def = defOf(o);
      if (o.slots) {
        const { w } = footprint(o.def, o.rot);
        const n = o.slots.length;
        const barW = (w * TILE - 8 - (n - 1) * 2) / n;
        o.slots.forEach((slot, i) => {
          const x = o.x * TILE + 4 + i * (barW + 2);
          const y = o.y * TILE + 3;
          g.fillStyle(0x10141c, 0.75).fillRect(x, y, barW, 5);
          if (!slot.product) return;
          const frac = batchQty(slot.batches) / (def.slotCapacity ?? 1);
          const color = Phaser.Display.Color.HexStringToColor(PRODUCTS[slot.product].color).color;
          if (frac > 0) g.fillStyle(color, 1).fillRect(x + 1, y + 1, Math.max(1, (barW - 2) * frac), 3);
          else g.fillStyle(0xe5605a, 1).fillRect(x + 1, y + 1, barW - 2, 3);
        });
      }
      const { w: fw, h: fh } = footprint(o.def, o.rot);
      if (o.broken) {
        // Out-of-order marker: a red disc with a cross.
        const cx = (o.x + fw / 2) * TILE;
        const cy = (o.y + fh / 2) * TILE;
        g.fillStyle(0xe5605a, 0.95).fillCircle(cx, cy, 9);
        g.lineStyle(3, 0xffffff, 1).lineBetween(cx - 4, cy - 4, cx + 4, cy + 4).lineBetween(cx + 4, cy - 4, cx - 4, cy + 4);
      } else if (def.kind === 'producer' && o.recipe && (o.progress ?? 0) > 0) {
        const frac = Math.min(1, (o.progress ?? 0) / (PRODUCTS[o.recipe].prepMinutes ?? 30));
        g.fillStyle(0x10141c, 0.75).fillRect(o.x * TILE + 4, o.y * TILE + 3, fw * TILE - 8, 5);
        g.fillStyle(0x4fc3a1, 1).fillRect(o.x * TILE + 5, o.y * TILE + 4, (fw * TILE - 10) * frac, 3);
      }
      if (def.kind === 'register') {
        const own = session.state.ownerAt;
        if (own && own.shopId === shop.id && own.objectId === o.id) {
          // The owner behind the counter. Hired staff become walking characters in milestone 5.
          const b = backTile(o);
          const cx = (b.x + 0.5) * TILE;
          const cy = (b.y + 0.5) * TILE;
          g.fillStyle(0x10141c, 0.3).fillCircle(cx + 1, cy + 2, 9);
          g.fillStyle(0x4fc3a1, 1).fillCircle(cx, cy, 9);
          g.fillStyle(0xf1d3b3, 1).fillCircle(cx, cy, 5);
        }
      }
    }
  }
}
