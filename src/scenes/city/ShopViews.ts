import Phaser from 'phaser';
import { charFrame } from '../../art/actorArt';
import { ATLAS, blit, SCALE } from '../../art/atlas';
import { furnFrame, furnFrameCount, slotAreas } from '../../art/furnitureArt';
import { TILE } from '../../core/constants';
import { session, shopById } from '../../core/state';
import { PRODUCTS } from '../../data';
import { backTile, batchQty, defOf, footprint, WALL_DOOR, WALL_NONE, type PlacedObject, type ShopState } from '../../entities/Shop';
import { regKey, rt } from '../../systems/ai/runtime';

interface View {
  structure: Phaser.GameObjects.Image;
  objects: Map<number, Phaser.GameObjects.Image>;
  badges: Map<number, Phaser.GameObjects.Image>;
  /** Goods on shelves, progress bars and litter. */
  detail: Phaser.GameObjects.Graphics;
  owner: Phaser.GameObjects.Image | null;
}

export const DEPTH = { ground: 0, structure: 1, lots: 2, rug: 3, objects: 10, bars: 11, npcs: 20, ghost: 40, bubbles: 50 };

/** Milliseconds per animation frame for machines. */
const ANIM_MS = 220;

const colorOf = (hex: string): number => Phaser.Display.Color.HexStringToColor(hex).color;
const darker = (c: number): number => Phaser.Display.Color.ValueToColor(c).darken(22).color;

/**
 * Draws every shop from atlas frames: a baked floor-and-wall texture, one image per piece
 * of furniture (animated while in use), and the goods actually sitting on each shelf.
 * Interiors are always open to view: walls are drawn as low blocks with no roof.
 */
export class ShopViews {
  private views = new Map<number, View>();
  private dirty = new Set<number>();
  private clock = 0;
  private animFrame = 0;

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
        badges: new Map(),
        detail: this.scene.add.graphics().setDepth(DEPTH.bars),
        owner: null,
      };
      this.views.set(shopId, v);
    }

    const tex = this.scene.textures.get(key) as Phaser.Textures.CanvasTexture;
    const ctx = tex.getContext();
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, lot.w * TILE, lot.h * TILE);
    const wallAt = (x: number, y: number): number => (x < 0 || y < 0 || x >= lot.w || y >= lot.h ? WALL_NONE : shop.wall[y * lot.w + x]);
    for (let y = 0; y < lot.h; y++) {
      for (let x = 0; x < lot.w; x++) {
        const i = y * lot.w + x;
        if (shop.floor[i]) blit(ctx, `floor:${shop.floor[i]}`, x * TILE, y * TILE);
        if (shop.wall[i] === WALL_DOOR) blit(ctx, wallAt(x - 1, y) !== WALL_NONE || wallAt(x + 1, y) !== WALL_NONE ? 'door_h' : 'door_v', x * TILE, y * TILE);
        else if (shop.wall[i] !== WALL_NONE) blit(ctx, 'wall', x * TILE, y * TILE);
      }
    }
    tex.refresh();

    const seen = new Set<number>();
    for (const o of shop.objects) {
      seen.add(o.id);
      let img = v.objects.get(o.id);
      if (!img) {
        img = this.scene.add.image(0, 0, ATLAS, furnFrame(o.def, o.rot)).setOrigin(0).setScale(SCALE);
        v.objects.set(o.id, img);
      }
      img.setFrame(furnFrame(o.def, o.rot, this.frameFor(shop, o)));
      img.setPosition(o.x * TILE, o.y * TILE);
      // Lower objects draw over higher ones, so tall things overlap correctly.
      img.setDepth((defOf(o).walkable ? DEPTH.rug : DEPTH.objects) + o.y / 1000);

      let badge = v.badges.get(o.id);
      if (o.broken && !badge) {
        badge = this.scene.add.image(0, 0, ATLAS, 'broken').setScale(SCALE).setDepth(DEPTH.bars + 0.5);
        v.badges.set(o.id, badge);
      } else if (!o.broken && badge) {
        badge.destroy();
        v.badges.delete(o.id);
        badge = undefined;
      }
      const { w, h } = footprint(o.def, o.rot);
      badge?.setPosition((o.x + w / 2) * TILE, (o.y + h / 2) * TILE);
    }
    for (const [id, img] of v.objects) {
      if (seen.has(id)) continue;
      img.destroy();
      v.objects.delete(id);
      v.badges.get(id)?.destroy();
      v.badges.delete(id);
    }
    this.drawDetail(shop, v);
  }

  remove(shopId: number): void {
    const v = this.views.get(shopId);
    if (!v) return;
    v.structure.destroy();
    v.detail.destroy();
    v.owner?.destroy();
    v.objects.forEach((img) => img.destroy());
    v.badges.forEach((img) => img.destroy());
    this.scene.textures.remove(`shop_struct_${shopId}`);
    this.views.delete(shopId);
  }

  /** Stock changes can fire many times a frame; redraw goods at most once per frame. */
  markStockDirty(shopId: number): void {
    this.dirty.add(shopId);
  }

  /** Call every frame with the real time elapsed. Advances machine animations and redraws changed stock. */
  flush(realDt = 0): void {
    this.clock += realDt * 1000;
    if (this.clock >= ANIM_MS && session.state.time.speed > 0) {
      this.clock = 0;
      this.animFrame++;
      for (const [id, v] of this.views) {
        const shop = shopById(session.state, id);
        if (!shop) continue;
        for (const o of shop.objects) {
          if (furnFrameCount(o.def) > 1) v.objects.get(o.id)?.setFrame(furnFrame(o.def, o.rot, this.frameFor(shop, o)));
        }
      }
    }
    if (!this.dirty.size) return;
    for (const id of this.dirty) {
      const shop = shopById(session.state, id);
      const v = this.views.get(id);
      if (shop && v) this.drawDetail(shop, v);
    }
    this.dirty.clear();
  }

  objectImage(shopId: number, objectId: number): Phaser.GameObjects.Image | undefined {
    return this.views.get(shopId)?.objects.get(objectId);
  }

  /** Machines animate only while something is happening: someone is using them, or a batch is running. */
  private frameFor(shop: ShopState, o: PlacedObject): number {
    if (o.broken || furnFrameCount(o.def) <= 1) return 0;
    const d = defOf(o);
    const inUse = (rt.stations.get(regKey(shop.id, o.id))?.length ?? 0) > 0;
    const running = d.kind === 'producer' ? (o.progress ?? 0) > 0 : d.kind === 'service' ? inUse : true;
    return running ? this.animFrame : 0;
  }

  private drawDetail(shop: ShopState, v: View): void {
    const g = v.detail;
    g.clear();
    const lot = session.city.lots[shop.lotId];

    // Litter: the dirtier the shop, the more of it lies around. Positions are fixed per shop so it does not flicker.
    const bits = Math.floor(shop.dirt / 7);
    for (let i = 0; i < bits; i++) {
      const tx = (shop.id * 7 + i * 13) % lot.w;
      const ty = (shop.id * 3 + i * 29) % lot.h;
      if (shop.wall[ty * lot.w + tx] !== WALL_NONE || !shop.floor[ty * lot.w + tx]) continue;
      const px = (lot.x + tx) * TILE + 6 + ((i * 11) % 9) * 2;
      const py = (lot.y + ty) * TILE + 6 + ((i * 17) % 9) * 2;
      g.fillStyle(i % 3 ? 0x8f673f : 0xe6dabf, 1).fillRect(px, py, 4, 2).fillRect(px + 2, py + 2, 2, 2);
    }

    for (const o of shop.objects) {
      const def = defOf(o);
      const { w: fw } = footprint(o.def, o.rot);
      const ox = o.x * TILE;
      const oy = o.y * TILE;

      if (o.slots && def.kind === 'shelf') {
        // The goods themselves: little packs in the product's colour, fewer as the shelf empties.
        const areas = slotAreas(o.def, o.rot, o.slots.length);
        o.slots.forEach((slot, i) => {
          const a = areas[i];
          if (!slot.product) return;
          const cols = Math.max(1, Math.floor((a.w + 1) / 4));
          const rows = Math.max(1, Math.floor((a.h + 1) / 4));
          const qty = batchQty(slot.batches);
          const show = qty <= 0 ? 0 : Math.max(1, Math.round((qty / (def.slotCapacity ?? 1)) * cols * rows));
          const color = colorOf(PRODUCTS[slot.product].color);
          const shade = darker(color);
          for (let n = 0; n < show; n++) {
            const x = ox + (a.x + (n % cols) * 4) * SCALE;
            const y = oy + (a.y + Math.floor(n / cols) * 4) * SCALE;
            g.fillStyle(color, 1).fillRect(x, y, 3 * SCALE, 3 * SCALE);
            g.fillStyle(shade, 1).fillRect(x, y + 2 * SCALE, 3 * SCALE, SCALE);
          }
          // An assigned but empty section gets a red tag so it is easy to spot.
          if (!show) g.fillStyle(0xe5605a, 1).fillRect(ox + a.x * SCALE, oy + a.y * SCALE, 3 * SCALE, 3 * SCALE);
        });
      } else if (o.slots && def.kind === 'vending') {
        // Three pips above the machine: green stocked, amber low, red empty.
        o.slots.forEach((slot, i) => {
          const frac = slot.product ? batchQty(slot.batches) / (def.slotCapacity ?? 1) : 0;
          g.fillStyle(0x10141c, 1).fillRect(ox + 4 + i * 8, oy - 6, 8, 6);
          g.fillStyle(frac > 0.4 ? 0x4fc3a1 : frac > 0 ? 0xf2b84b : 0xe5605a, 1).fillRect(ox + 6 + i * 8, oy - 4, 4, 2);
        });
      }

      if (def.kind === 'producer' && o.recipe && (o.progress ?? 0) > 0 && !o.broken) {
        const frac = Math.min(1, (o.progress ?? 0) / (PRODUCTS[o.recipe].prepMinutes ?? 30));
        g.fillStyle(0x10141c, 0.85).fillRect(ox + 4, oy - 6, fw * TILE - 8, 6);
        g.fillStyle(0x4fc3a1, 1).fillRect(ox + 6, oy - 4, (fw * TILE - 12) * frac, 2);
      }
    }

    // The owner stands behind whichever checkout they are working.
    const own = session.state.ownerAt;
    const reg = own && own.shopId === shop.id ? shop.objects.find((o) => o.id === own.objectId) : undefined;
    if (reg) {
      const b = backTile(reg);
      v.owner ??= this.scene.add.image(0, 0, ATLAS, charFrame(0, 'down', 0)).setScale(SCALE).setOrigin(0.5, 0.75);
      const facing = (['down', 'left', 'up', 'right'] as const)[reg.rot % 4];
      v.owner.setFrame(charFrame(0, facing, 0)).setPosition((b.x + 0.5) * TILE, (b.y + 0.5) * TILE).setDepth(DEPTH.npcs + b.y / 1000).setVisible(true);
    } else v.owner?.setVisible(false);
  }
}
