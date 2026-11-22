import Phaser from 'phaser';
import { bakeCity } from '../art/cityArt';
import { SPEEDS, TILE } from '../core/constants';
import { bus, toast } from '../core/events';
import { clamp, money } from '../core/format';
import { session, shopOnLot } from '../core/state';
import { resetUi, selectLot, selectObject, ui } from '../core/uiState';
import { inLot, objectAt, footprint } from '../entities/Shop';
import { driftMarket } from '../systems/economy/market';
import { expireStock, processDeliveries } from '../systems/economy/stock';
import { BuildTool } from './city/BuildTool';
import { DEPTH, ShopViews } from './city/ShopViews';
import { ShopPanel } from '../ui/panels/ShopPanel';
import { ObjectPanel } from '../ui/panels/ObjectPanel';
import { idx, type LotDef } from '../systems/city/generate';
import { closeDay } from '../systems/economy/finance';
import { chargeDailyRent, rentOf } from '../systems/economy/property';
import { advanceClock, darkness, hourFloat, setSpeed } from '../systems/time/clock';
import { clear, h, nightLayer, uiRoot } from '../ui/dom';
import { TopBar } from '../ui/hud/TopBar';
import { LotPanel } from '../ui/panels/LotPanel';
import { mountToasts } from '../ui/toasts';
import { hideTip, showTip } from '../ui/tooltip';
import { NEIGHBORHOODS } from '../data';

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.5;
const PAN_SPEED = 900;
const DRAG_THRESHOLD = 6;

/** The city view: world rendering, camera, input, and the per-frame simulation tick. */
export class CityScene extends Phaser.Scene {
  private lotGfx!: Phaser.GameObjects.Graphics;
  private hoverGfx!: Phaser.GameObjects.Graphics;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private hoverLot = -1;
  private selectedLot: number | null = null;
  private dragging = false;
  private cleanups: (() => void)[] = [];
  private night = nightLayer();
  private lastSpeed = 1;
  private shopViews!: ShopViews;
  private buildTool!: BuildTool;
  private selGfx!: Phaser.GameObjects.Graphics;

  constructor() {
    super('City');
  }

  create(): void {
    const { city, state } = session;
    this.cleanups = [];
    this.hoverLot = -1;
    this.selectedLot = null;
    resetUi();

    for (const chunk of bakeCity(this, city)) {
      this.add.image(chunk.tx * TILE, chunk.ty * TILE, chunk.key).setOrigin(0).setDepth(0);
    }
    this.lotGfx = this.add.graphics().setDepth(DEPTH.lots);
    this.hoverGfx = this.add.graphics().setDepth(DEPTH.lots);
    this.selGfx = this.add.graphics().setDepth(DEPTH.ghost);
    this.shopViews = new ShopViews(this);
    this.buildTool = new BuildTool(this);
    for (const shop of state.shops) this.shopViews.sync(shop.id);
    this.drawLots();

    this.setupCamera();
    this.setupInput();
    this.setupHud();

    this.cleanups.push(
      bus.on('lot:changed', () => this.drawLots()),
      bus.on('lot:selected', (id) => {
        this.selectedLot = id;
        if (this.buildTool.active) this.buildTool.cancel();
        this.drawHover();
      }),
      bus.on('time:day', (day) => this.onNewDay(day)),
      bus.on('time:minute', () => processDeliveries(session.state)),
      bus.on('shop:changed', (id) => this.shopViews.sync(id)),
      bus.on('shop:removed', (id) => this.shopViews.remove(id)),
      bus.on('stock:changed', (id) => this.shopViews.markStockDirty(id)),
      bus.on('object:selected', () => this.drawSelection()),
      bus.on('shop:changed', () => this.drawSelection()),
    );

    this.events.once('shutdown', () => {
      this.cleanups.forEach((fn) => fn());
      bus.clear();
      clear(uiRoot());
      this.night.style.opacity = '0';
      hideTip();
    });

    toast(`Welcome to the city. You have ${money(state.money)}. Click a lot with a yellow outline to rent it.`);
  }

  // ---------- Setup ----------

  private setupCamera(): void {
    const { city } = session;
    const cam = this.cameras.main;
    const pad = 6 * TILE;
    cam.setBounds(-pad, -pad, city.w * TILE + pad * 2, city.h * TILE + pad * 2);
    cam.setBackgroundColor('#2c5d8a');
    cam.setZoom(1);
    // Start over the cheapest available lot, which is where a broke founder would look first.
    const start = city.lots.filter((l) => l.rentable).sort((a, b) => a.rent - b.rent)[0];
    if (start) cam.centerOn((start.x + start.w / 2) * TILE, (start.y + start.h / 2) * TILE);
  }

  private setupInput(): void {
    const kb = this.input.keyboard!;
    this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT') as Record<string, Phaser.Input.Keyboard.Key>;
    const time = session.state.time;

    kb.on('keydown-SPACE', () => {
      if (time.speed > 0) {
        this.lastSpeed = time.speed;
        setSpeed(time, 0);
      } else setSpeed(time, this.lastSpeed || 1);
    });
    kb.on('keydown-ONE', () => setSpeed(time, SPEEDS[1]));
    kb.on('keydown-TWO', () => setSpeed(time, SPEEDS[2]));
    kb.on('keydown-THREE', () => setSpeed(time, SPEEDS[3]));
    kb.on('keydown-ESC', () => {
      if (this.buildTool.active) this.buildTool.cancel();
      else if (ui.selectedObject) selectObject(null);
      else selectLot(null);
    });
    kb.on('keydown-R', () => this.buildTool.rotate());
    kb.on('keydown-PLUS', () => this.zoomBy(1.2));
    kb.on('keydown-MINUS', () => this.zoomBy(1 / 1.2));
    kb.on('keydown-NUMPAD_ADD', () => this.zoomBy(1.2));
    kb.on('keydown-NUMPAD_SUBTRACT', () => this.zoomBy(1 / 1.2));

    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.zoomBy(dy > 0 ? 1 / 1.15 : 1.15, p);
    });

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.dragging = false;
      if (!this.buildTool.active) return;
      if (p.rightButtonDown()) this.buildTool.cancel();
      else if (p.leftButtonDown()) {
        const t = this.tileAt(p);
        this.buildTool.onDown(t.x, t.y);
      }
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const building = this.buildTool.active;
      // With a build tool out, the left button builds; pan with the middle or right button instead.
      const panning = p.isDown && (!building || !p.leftButtonDown());
      if (panning) {
        if (!this.dragging && p.getDistance() > DRAG_THRESHOLD) this.dragging = true;
        if (this.dragging) {
          const cam = this.cameras.main;
          cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
          cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
        }
        hideTip();
        return;
      }
      if (building) {
        const t = this.tileAt(p);
        this.buildTool.onMove(t.x, t.y, p.leftButtonDown());
        hideTip();
        return;
      }
      this.updateHover(p);
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.buildTool.active) {
        this.buildTool.onUp();
        this.dragging = false;
        return;
      }
      if (this.dragging) {
        this.dragging = false;
        return;
      }
      if (p.leftButtonReleased()) this.clickWorld(p);
    });
    this.input.on('gameout', () => {
      this.hoverLot = -1;
      this.drawHover();
      hideTip();
    });
  }

  private setupHud(): void {
    const parts = [TopBar(), LotPanel(), ShopPanel(), ObjectPanel()];
    uiRoot().append(...parts.map((p) => p.el), h('div.hint', 'Drag or WASD to move · Scroll to zoom · Space to pause'));
    this.cleanups.push(...parts.map((p) => p.destroy), mountToasts());
  }

  // ---------- Camera ----------

  private zoomBy(factor: number, pointer?: Phaser.Input.Pointer): void {
    const cam = this.cameras.main;
    const next = clamp(cam.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (next === cam.zoom) return;
    if (!pointer) {
      cam.setZoom(next);
      return;
    }
    // Keep the world point under the cursor fixed while zooming.
    const before = cam.getWorldPoint(pointer.x, pointer.y);
    cam.setZoom(next);
    cam.preRender();
    const after = cam.getWorldPoint(pointer.x, pointer.y);
    cam.scrollX += before.x - after.x;
    cam.scrollY += before.y - after.y;
  }

  // ---------- Lots ----------

  private tileAt(p: Phaser.Input.Pointer): { x: number; y: number } {
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    return { x: Math.floor(w.x / TILE), y: Math.floor(w.y / TILE) };
  }

  /** Left click with no tool: select a piece of furniture in your shop, or the lot. */
  private clickWorld(p: Phaser.Input.Pointer): void {
    const lot = this.lotAtPointer(p);
    if (!lot?.rentable) return selectLot(null);
    const shop = shopOnLot(session.state, lot.id);
    const t = this.tileAt(p);
    const obj = shop && inLot(lot, t.x, t.y) ? objectAt(shop, t.x, t.y) : undefined;
    if (ui.selectedLot !== lot.id) selectLot(lot.id);
    selectObject(shop && obj ? { shopId: shop.id, objectId: obj.id } : null);
  }

  private drawSelection(): void {
    const g = this.selGfx;
    g.clear();
    const sel = ui.selectedObject;
    if (!sel) return;
    const obj = session.state.shops.find((sh) => sh.id === sel.shopId)?.objects.find((o) => o.id === sel.objectId);
    if (!obj) return;
    const { w, h: fh } = footprint(obj.def, obj.rot);
    g.lineStyle(2, 0xffffff, 1).strokeRect(obj.x * TILE - 1, obj.y * TILE - 1, w * TILE + 2, fh * TILE + 2);
  }

  private lotAtPointer(p: Phaser.Input.Pointer): LotDef | null {
    const { city } = session;
    const { x: tx, y: ty } = this.tileAt(p);
    if (tx < 0 || ty < 0 || tx >= city.w || ty >= city.h) return null;
    const id = city.lotAt[idx(city, tx, ty)];
    return id >= 0 ? city.lots[id] : null;
  }

  private updateHover(p: Phaser.Input.Pointer): void {
    const lot = this.lotAtPointer(p);
    const id = lot?.rentable ? lot.id : -1;
    if (id !== this.hoverLot) {
      this.hoverLot = id;
      this.drawHover();
    }
    if (lot?.rentable && shopOnLot(session.state, lot.id)) hideTip();
    else if (lot?.rentable) {
      const s = session.state;
      const own = s.lots[lot.id];
      const n = NEIGHBORHOODS[lot.district];
      const line = own ? (own.owner === 'owned' ? 'Owned by you' : `Leased · ${money(rentOf(s, lot))}/day`) : `For rent · ${money(rentOf(s, lot))}/day`;
      const ev = p.event as MouseEvent;
      showTip(`Lot #${lot.id} · ${n.name}\n${lot.w} × ${lot.h} tiles\n${line}`, ev.clientX, ev.clientY);
    } else hideTip();
  }

  /** Outlines for every rentable lot: yellow = available, green = yours. */
  private drawLots(): void {
    const { city, state } = session;
    const g = this.lotGfx;
    g.clear();
    for (const lot of city.lots) {
      if (!lot.rentable) continue;
      const own = state.lots[lot.id];
      const color = own ? 0x4fc3a1 : 0xf2d24b;
      const x = lot.x * TILE;
      const y = lot.y * TILE;
      const w = lot.w * TILE;
      const hgt = lot.h * TILE;
      const hasShop = !!shopOnLot(state, lot.id);
      if (own && !hasShop) g.fillStyle(color, 0.08).fillRect(x, y, w, hgt);
      if (hasShop) g.lineStyle(2, color, 0.9).strokeRect(x - 1, y - 1, w + 2, hgt + 2);
      else g.lineStyle(3, color, own ? 0.95 : 0.7).strokeRect(x + 2, y + 2, w - 4, hgt - 4);
      if (!own) {
        // "For rent" sign post near the street edge.
        const sx = x + w / 2;
        const sy = lot.front === 'n' ? y + 14 : y + hgt - 14;
        g.fillStyle(0x4a3b2f, 1).fillRect(sx - 1, sy - 2, 3, 10);
        g.fillStyle(0xf2d24b, 1).fillRect(sx - 9, sy - 9, 19, 9);
        g.fillStyle(0x4a3b2f, 1).fillRect(sx - 6, sy - 6, 13, 1).fillRect(sx - 6, sy - 3, 9, 1);
      }
    }
  }

  private drawHover(): void {
    const { city } = session;
    const g = this.hoverGfx;
    g.clear();
    const outline = (id: number, color: number, alpha: number, fill: number): void => {
      const lot = city.lots[id];
      g.fillStyle(color, fill).fillRect(lot.x * TILE, lot.y * TILE, lot.w * TILE, lot.h * TILE);
      g.lineStyle(4, color, alpha).strokeRect(lot.x * TILE + 2, lot.y * TILE + 2, lot.w * TILE - 4, lot.h * TILE - 4);
    };
    if (this.hoverLot >= 0 && this.hoverLot !== this.selectedLot) outline(this.hoverLot, 0xffffff, 0.8, 0.1);
    if (this.selectedLot !== null) outline(this.selectedLot, 0xffffff, 1, shopOnLot(session.state, this.selectedLot) ? 0 : 0.16);
  }

  // ---------- Simulation ----------

  private onNewDay(day: number): void {
    const { state, city } = session;
    const rent = chargeDailyRent(state, city);
    closeDay(state, day);
    driftMarket(state);
    expireStock(state);
    if (rent > 0) toast(`Day ${day}. Paid ${money(rent)} in rent.`, 'info');
  }

  override update(_time: number, deltaMs: number): void {
    // Clamp so a long stall (alt-tab) cannot fast-forward the simulation.
    const dt = Math.min(deltaMs, 100) / 1000;
    const cam = this.cameras.main;

    const k = this.keys;
    const step = (PAN_SPEED * dt) / cam.zoom;
    if (k.A.isDown || k.LEFT.isDown) cam.scrollX -= step;
    if (k.D.isDown || k.RIGHT.isDown) cam.scrollX += step;
    if (k.W.isDown || k.UP.isDown) cam.scrollY -= step;
    if (k.S.isDown || k.DOWN.isDown) cam.scrollY += step;

    advanceClock(session.state.time, dt);
    this.shopViews.flush();
    this.night.style.opacity = (darkness(hourFloat(session.state.time)) * 0.55).toFixed(3);
  }
}
