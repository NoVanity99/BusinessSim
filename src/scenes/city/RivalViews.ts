import Phaser from 'phaser';
import { drawBuilding } from '../../art/cityArt';
import { TILE } from '../../core/constants';
import { bus } from '../../core/events';
import { session } from '../../core/state';
import { brandsOnMap, rivalById, rivalOpenNow, type RivalShop } from '../../systems/rivals/rivals';
import { dayOf } from '../../systems/time/clock';
import { DEPTH } from './ShopViews';

interface View {
  building: Phaser.GameObjects.Image;
  sign: Phaser.GameObjects.Text;
  sale: Phaser.GameObjects.Text;
  key: string;
}

/**
 * Draws rival companies' shops: a roofed building in the company's colours on the lot it
 * rents, with a name sign over the door and a banner while a sale is on.
 */
export class RivalViews {
  private views = new Map<number, View>();
  private offs: (() => void)[];

  constructor(private scene: Phaser.Scene) {
    this.offs = [bus.on('rivals:changed', () => this.sync()), bus.on('time:hour', () => this.refresh())];
    this.sync();
  }

  private make(company: { color: string; roof: string }, shop: RivalShop): View {
    const lot = session.city.lots[shop.lotId];
    const key = `rival_${shop.id}`;
    if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    const tex = this.scene.textures.createCanvas(key, lot.w * TILE, lot.h * TILE)!;
    const ctx = tex.getContext();
    ctx.imageSmoothingEnabled = false;
    drawBuilding(ctx, lot, lot.x * TILE, lot.y * TILE, company.roof, shop.id);
    // A band in the company colour along the street side, so its shops are recognisable from afar.
    ctx.fillStyle = company.color;
    const bandY = lot.front === 'n' ? TILE : (lot.h - 1) * TILE - 6;
    ctx.fillRect(2, bandY, lot.w * TILE - 4, 5);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(2, bandY + 5, lot.w * TILE - 4, 1);
    tex.refresh();

    const cx = (lot.x + lot.w / 2) * TILE;
    const signY = lot.front === 'n' ? (lot.y + 1) * TILE + 14 : (lot.y + lot.h - 1) * TILE - 14;
    const style = { fontFamily: 'system-ui, sans-serif', fontSize: '11px', fontStyle: 'bold', color: '#ffffff', padding: { x: 5, y: 2 } };
    return {
      key,
      building: this.scene.add.image(lot.x * TILE, lot.y * TILE, key).setOrigin(0).setDepth(DEPTH.structure),
      sign: this.scene.add.text(cx, signY, shop.name, { ...style, backgroundColor: company.color }).setOrigin(0.5).setDepth(DEPTH.lots + 0.5).setResolution(2),
      sale: this.scene.add.text(cx, signY + 18, 'SALE', { ...style, color: '#1a1d24', backgroundColor: '#f2d24b' }).setOrigin(0.5).setDepth(DEPTH.lots + 0.5).setResolution(2).setVisible(false),
    };
  }

  /** Add views for new rival shops and drop those that have closed. */
  private sync(): void {
    const live = new Set<number>();
    for (const company of brandsOnMap(session.state)) {
      for (const shop of company.shops) {
        live.add(shop.id);
        if (!this.views.has(shop.id)) this.views.set(shop.id, this.make(company, shop));
      }
    }
    for (const [id, v] of this.views) {
      if (live.has(id)) continue;
      v.building.destroy();
      v.sign.destroy();
      v.sale.destroy();
      this.scene.textures.remove(v.key);
      this.views.delete(id);
    }
    this.refresh();
  }

  /** Sale banners, and a dimmed sign outside opening hours. */
  private refresh(): void {
    const s = session.state;
    const open = rivalOpenNow(s);
    for (const company of brandsOnMap(s)) {
      for (const shop of company.shops) {
        const v = this.views.get(shop.id);
        if (!v) continue;
        v.sale.setVisible(open && shop.saleUntil >= dayOf(s.time));
        v.sign.setAlpha(open ? 1 : 0.6);
      }
    }
  }

  /** Lit windows for the night-time lighting pass: one light per open rival shop. */
  lights(): { x: number; y: number; radius: number }[] {
    if (!rivalOpenNow(session.state)) return [];
    return [...this.views.keys()].flatMap((id) => {
      const shop = rivalById(session.state, id);
      if (!shop) return [];
      const lot = session.city.lots[shop.lotId];
      return [{ x: (lot.x + lot.w / 2) * TILE, y: (lot.front === 'n' ? lot.y : lot.y + lot.h) * TILE, radius: 90 }];
    });
  }

  destroy(): void {
    this.offs.forEach((off) => off());
    for (const v of this.views.values()) {
      v.building.destroy();
      v.sign.destroy();
      v.sale.destroy();
    }
    this.views.clear();
  }
}
