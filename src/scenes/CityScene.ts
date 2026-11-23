import Phaser from 'phaser';
import { bakeCity } from '../art/cityArt';
import { SPEEDS, TILE } from '../core/constants';
import { isCodeDown, isDown, onAction } from '../core/input';
import { music, sfx } from '../systems/audio/audio';
import { installAutosave, loadGameDetailed, saveGame } from '../systems/save/saves';
import { PauseMenu } from '../ui/screens/PauseMenu';
import { Sidebar } from '../ui/panels/Windows';
import { Guide } from '../ui/hud/Guide';
import { onUpdateState, updaterHooks } from '../systems/update/updater';
import { AUTOSAVE } from '../systems/save/saves';
import { bus, toast } from '../core/events';
import { clamp, money } from '../core/format';
import { session, shopOnLot } from '../core/state';
import { resetUi, selectLot, selectNpc, selectObject, selectStaff, ui } from '../core/uiState';
import { StaffInfoPanel } from '../ui/panels/StaffInfoPanel';
import { rt } from '../systems/ai/runtime';
import { defOf } from '../entities/Shop';
import { NpcViews } from './city/NpcViews';
import { NpcPanel } from '../ui/panels/NpcPanel';
import { inLot, objectAt, footprint } from '../entities/Shop';
import { installSim, stepSimulation } from '../systems/sim';
import { BuildTool } from './city/BuildTool';
import { DEPTH, ShopViews } from './city/ShopViews';
import { ShopPanel } from '../ui/panels/ShopPanel';
import { ObjectPanel } from '../ui/panels/ObjectPanel';
import { idx, type LotDef } from '../systems/city/generate';
import { rentOf } from '../systems/economy/property';
import { darkness, hourFloat, setSpeed } from '../systems/time/clock';
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
  private pauseEl: HTMLElement | null = null;
  private speedBeforeMenu = 1;
  private sidebar!: ReturnType<typeof Sidebar>;
  private hoverLot = -1;
  private selectedLot: number | null = null;
  private dragging = false;
  private cleanups: (() => void)[] = [];
  private night = nightLayer();
  private lastSpeed = 1;
  private shopViews!: ShopViews;
  private buildTool!: BuildTool;
  private selGfx!: Phaser.GameObjects.Graphics;
  private npcViews!: NpcViews;
  private overlayGfx!: Phaser.GameObjects.Graphics;
  private overlayTimer = 0;
  private stepTimer = 0;
  private frame = 0;
  /** Where each shop stands, for placing its sounds. */
  private shopLots = new Map<number, number>();

  constructor() {
    super('City');
  }

  create(): void {
    const { city, state } = session;
    this.cleanups = [];
    this.pauseEl = null;
    music.start();
    this.hoverLot = -1;
    this.selectedLot = null;
    resetUi();

    for (const chunk of bakeCity(this, city)) {
      this.add.image(chunk.tx * TILE, chunk.ty * TILE, chunk.key).setOrigin(0).setDepth(0);
    }
    this.lotGfx = this.add.graphics().setDepth(DEPTH.lots);
    this.hoverGfx = this.add.graphics().setDepth(DEPTH.lots);
    this.selGfx = this.add.graphics().setDepth(DEPTH.ghost);
    this.overlayGfx = this.add.graphics().setDepth(DEPTH.bars + 1);
    this.shopViews = new ShopViews(this);
    this.buildTool = new BuildTool(this);
    for (const shop of state.shops) this.shopViews.sync(shop.id);
    this.shopLots = new Map(state.shops.map((sh) => [sh.id, sh.lotId]));
    // The simulation (people, cars, schedules) must exist before anything draws it.
    this.cleanups.push(installSim());
    this.npcViews = new NpcViews(this);
    this.drawLots();

    this.setupCamera();
    this.setupInput();
    this.setupHud();
    // If the player restarts to update mid-game, their progress goes into the autosave first.
    updaterHooks.beforeInstall = () => saveGame(AUTOSAVE, true);

    this.cleanups.push(
      bus.on('lot:changed', () => this.drawLots()),
      bus.on('lot:selected', (id) => {
        this.selectedLot = id;
        if (this.buildTool.active) this.buildTool.cancel();
        this.drawHover();
      }),
      installAutosave(),
      // Updates never interrupt play: one quiet toast per stage, and the details wait in Settings.
      (() => {
        let last = '';
        return onUpdateState((u) => {
          const key = `${u.status}:${u.version ?? ''}`;
          if (key === last) return;
          last = key;
          if (u.status === 'available' && !u.autoDownload) toast(`Update v${u.version} is available. See Settings in the pause menu when you have a moment.`, 'info');
          if (u.status === 'available' && u.portable && u.autoDownload) toast(`Version ${u.version} is out. See Settings in the pause menu for the download.`, 'info');
          if (u.status === 'downloaded') toast(`Update v${u.version} is ready. It installs when you quit, or restart from Settings.`, 'good');
        });
      })(),
      () => (updaterHooks.beforeInstall = null),
      bus.on('overlay:changed', () => this.drawOverlay()),
      bus.on('game:won', () => this.showEnding(true)),
      bus.on('game:over', () => this.showEnding(false)),
      bus.on('level:up', () => sfx('good')),
      bus.on('time:hour', () => session.state.shops.forEach((sh) => this.shopViews.markStockDirty(sh.id))),
      bus.on('sale', ({ x, y }) => sfx('register', this.audibility(x, y))),
      bus.on('door:enter', ({ shopId }) => {
        const lot = session.city.lots[this.shopLots.get(shopId) ?? -1];
        if (lot) sfx('door', this.audibility(lot.x + lot.w / 2, lot.y + lot.h / 2) * 0.7);
      }),
      bus.on('toast', ({ kind }) => kind === 'bad' && sfx('error', 0.6)),
      bus.on('shop:created', () => sfx('good')),
      bus.on('orders:changed', () => sfx('delivery', 0.5)),
      bus.on('shop:changed', (id) => {
        this.shopViews.sync(id);
        const lotId = session.state.shops.find((sh) => sh.id === id)?.lotId;
        if (lotId === undefined) return;
        this.shopLots.set(id, lotId);
      }),
      bus.on('shop:removed', (id) => {
        this.shopViews.remove(id);
        this.shopLots.delete(id);
      }),
      () => this.npcViews.destroy(),
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

    if (!state.shops.length && !Object.keys(state.lots).length) toast(`Welcome to the city. You have ${money(state.money)}. Click a lot with a yellow outline to rent it.`);
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
    const held = session.state.shops[0]?.lotId ?? Object.keys(session.state.lots).map(Number)[0];
    const start = held !== undefined ? city.lots[held] : city.lots.filter((l) => l.rentable).sort((a, b) => a.rent - b.rent)[0];
    if (start) cam.centerOn((start.x + start.w / 2) * TILE, (start.y + start.h / 2) * TILE);
  }

  private setupInput(): void {
    const time = session.state.time;
    const paused = (): boolean => this.pauseEl !== null;
    const act = (fn: () => void) => () => { if (!paused()) fn(); };
    this.cleanups.push(
      onAction('pause', act(() => {
        if (time.speed > 0) {
          this.lastSpeed = time.speed;
          setSpeed(time, 0);
        } else setSpeed(time, this.lastSpeed || 1);
      })),
      onAction('speed1', act(() => setSpeed(time, SPEEDS[1]))),
      onAction('speed2', act(() => setSpeed(time, SPEEDS[2]))),
      onAction('speed3', act(() => setSpeed(time, SPEEDS[3]))),
      onAction('rotate', act(() => this.buildTool.rotate())),
      onAction('zoomIn', act(() => this.zoomBy(1.2))),
      onAction('zoomOut', act(() => this.zoomBy(1 / 1.2))),
      onAction('quickSave', act(() => void saveGame('slot1'))),
      onAction('businesses', act(() => this.sidebar.toggle('businesses'))),
      onAction('finances', act(() => this.sidebar.toggle('finances'))),
      onAction('staff', act(() => this.sidebar.toggle('staff'))),
      // The menu key backs out of whatever is open, one layer at a time, then pauses.
      onAction('menu', () => {
        if (paused()) this.closePauseMenu();
        else if (this.buildTool.active) this.buildTool.cancel();
        else if (ui.selectedNpc !== null) selectNpc(null);
        else if (ui.selectedStaff !== null) selectStaff(null);
        else if (ui.selectedObject) selectObject(null);
        else if (ui.selectedLot !== null) selectLot(null);
        else this.openPauseMenu();
      }),
    );

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
    this.sidebar = Sidebar((lotId) => {
      const lot = session.city.lots[lotId];
      this.cameras.main.centerOn((lot.x + lot.w / 2) * TILE, (lot.y + lot.h / 2) * TILE);
    }, () => this.openPauseMenu());
    const parts = [TopBar(), this.sidebar, LotPanel(), ShopPanel(), ObjectPanel(), NpcPanel(), StaffInfoPanel(), Guide()];
    uiRoot().append(...parts.map((p) => p.el), h('div.hint', 'Drag or WASD to move · Scroll to zoom · Space to pause'));
    this.cleanups.push(...parts.map((p) => p.destroy), mountToasts());
  }

  /** 0-1: how loud something at a tile should be, based on whether it is on screen and how far out we are zoomed. */
  private audibility(tx: number, ty: number): number {
    const cam = this.cameras.main;
    const v = cam.worldView;
    const x = tx * TILE;
    const y = ty * TILE;
    if (x < v.x - 200 || y < v.y - 200 || x > v.right + 200 || y > v.bottom + 200) return 0;
    return clamp(cam.zoom, 0.25, 1);
  }

  // ---------- Overlays ----------

  /** Blend between two colours; t in 0-1. */
  private mix(a: number, b: number, t: number): number {
    const ch = (shift: number): number => Math.round(((a >> shift) & 255) + (((b >> shift) & 255) - ((a >> shift) & 255)) * t);
    return (ch(16) << 16) | (ch(8) << 8) | ch(0);
  }

  /** Orange for bad, grey in the middle, blue for good. */
  private diverging(t: number): number {
    return t < 0.5 ? this.mix(0xd95926, 0x8f9bb0, t * 2) : this.mix(0x8f9bb0, 0x3987e5, (t - 0.5) * 2);
  }

  private drawOverlay(): void {
    const g = this.overlayGfx;
    g.clear();
    if (!ui.overlay) return;
    const { city, state } = session;
    if (ui.overlay === 'traffic') {
      let max = 1;
      for (let i = 0; i < rt.heat.length; i++) if (rt.heat[i] > max) max = rt.heat[i];
      for (let i = 0; i < rt.heat.length; i++) {
        const v = rt.heat[i] / max;
        if (v < 0.03) continue;
        // Square-root scale so quiet streets still register next to the busiest corner.
        g.fillStyle(0x3987e5, 0.1 + 0.75 * Math.sqrt(v)).fillRect((i % city.w) * TILE, Math.floor(i / city.w) * TILE, TILE, TILE);
      }
      return;
    }
    for (const shop of state.shops) {
      const lot = city.lots[shop.lotId];
      const t = ui.overlay === 'clean' ? 1 - shop.dirt / 100 : clamp(((shop.moodAvg ?? 60) - 25) / 60, 0, 1);
      g.fillStyle(this.diverging(t), 0.6).fillRect(lot.x * TILE, lot.y * TILE, lot.w * TILE, lot.h * TILE);
      g.lineStyle(3, 0xffffff, 0.8).strokeRect(lot.x * TILE, lot.y * TILE, lot.w * TILE, lot.h * TILE);
    }
  }

  private showEnding(won: boolean): void {
    const s = session.state;
    setSpeed(s.time, 0);
    const close = (): void => {
      el.remove();
      if (won) setSpeed(s.time, 1);
      else this.scene.start('Menu');
    };
    const el = h(
      'div.overlay',
      h(
        'div.panel.window',
        { style: { position: 'relative', width: '460px' } },
        h('h2', won ? 'You made it!' : 'Bankrupt'),
        h('div.modal-text', won ? `${s.companyName} has reached its net-worth goal. The city is yours. You can keep playing for as long as you like.` : `${s.companyName} has run out of money and credit, and the bank has closed the business. Load an earlier save or start again.`),
        h('div.row', { style: { justifyContent: 'flex-end' } }, h('button.primary', { onclick: close }, won ? 'Keep playing' : 'Back to the main menu')),
      ),
    );
    uiRoot().append(el);
    sfx(won ? 'good' : 'error');
  }

  // ---------- Pause menu ----------

  private openPauseMenu(): void {
    if (this.pauseEl) return;
    const time = session.state.time;
    this.speedBeforeMenu = time.speed;
    setSpeed(time, 0);
    this.pauseEl = PauseMenu({
      onResume: () => this.closePauseMenu(),
      onSave: (slot) => {
        // Store the speed the game was running at, not the menu's pause.
        const t = session.state.time;
        t.speed = this.speedBeforeMenu;
        void saveGame(slot).finally(() => (t.speed = this.pauseEl ? 0 : t.speed));
      },
      onLoad: (slot) =>
        void loadGameDetailed(slot).then((result) => {
          if (result.ok) this.scene.restart();
          else toast(result.reason, 'bad');
        }),
      onQuitToMenu: () => this.scene.start('Menu'),
    });
    uiRoot().append(this.pauseEl);
  }

  private closePauseMenu(): void {
    if (!this.pauseEl) return;
    this.pauseEl.remove();
    this.pauseEl = null;
    setSpeed(session.state.time, this.speedBeforeMenu);
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
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    const staff = this.npcViews.pickStaff(w.x, w.y);
    const npc = staff === null ? this.npcViews.pick(w.x, w.y) : null;
    if (staff !== null || npc !== null) {
      selectObject(null);
      selectNpc(npc);
      return selectStaff(staff);
    }
    if (ui.selectedNpc !== null) selectNpc(null);
    if (ui.selectedStaff !== null) selectStaff(null);
    const t = this.tileAt(p);
    // Vending machines stand on the street, outside any lot.
    const machine = rt.vendingAt.get(t.y * session.city.w + t.x);
    if (machine) {
      const owner = session.state.shops.find((sh) => sh.id === machine.shopId);
      if (owner) {
        if (ui.selectedLot !== owner.lotId) selectLot(owner.lotId);
        return selectObject({ shopId: owner.id, objectId: machine.objId });
      }
    }
    const lot = this.lotAtPointer(p);
    if (!lot?.rentable) return selectLot(null);
    const shop = shopOnLot(session.state, lot.id);
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

  override update(_time: number, deltaMs: number): void {
    // Clamp so a long stall (alt-tab) cannot fast-forward the simulation.
    const dt = Math.min(deltaMs, 100) / 1000;
    const cam = this.cameras.main;

    if (!this.pauseEl) {
      const step = (PAN_SPEED * dt) / cam.zoom;
      if (isDown('panLeft') || isCodeDown('ArrowLeft')) cam.scrollX -= step;
      if (isDown('panRight') || isCodeDown('ArrowRight')) cam.scrollX += step;
      if (isDown('panUp') || isCodeDown('ArrowUp')) cam.scrollY -= step;
      if (isDown('panDown') || isCodeDown('ArrowDown')) cam.scrollY += step;
    }

    stepSimulation(dt);
    // Production progress bars creep forward without any stock event; refresh them now and then.
    this.frame = (this.frame + 1) % 30;
    if (this.frame === 0) for (const shop of session.state.shops) if (shop.objects.some((o) => defOf(o).kind === 'producer' && (o.progress ?? 0) > 0)) this.shopViews.markStockDirty(shop.id);
    this.npcViews.update(dt);
    this.shopViews.flush();
    this.stepTimer -= dt * session.state.time.speed;
    if (this.stepTimer <= 0 && cam.zoom >= 1.3 && session.state.time.speed > 0) {
      this.stepTimer = 0.32;
      const v = cam.worldView;
      let near = 0;
      for (const c of rt.customers) if (c.x * TILE > v.x && c.x * TILE < v.right && c.y * TILE > v.y && c.y * TILE < v.bottom && c.path.length) near++;
      if (near) sfx('footstep', Math.min(0.5, 0.15 + near * 0.02));
    }
    // Overlays read live data; refresh about once a second.
    this.overlayTimer += dt;
    if (ui.overlay && this.overlayTimer > 1) {
      this.overlayTimer = 0;
      this.drawOverlay();
    }
    this.night.style.opacity = (darkness(hourFloat(session.state.time)) * 0.55).toFixed(3);
  }
}
