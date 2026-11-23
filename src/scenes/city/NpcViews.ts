import Phaser from 'phaser';
import { TILE } from '../../core/constants';
import { bus } from '../../core/events';
import { money } from '../../core/format';
import { ui } from '../../core/uiState';
import { rt } from '../../systems/ai/runtime';
import { session } from '../../core/state';
import { carFrame, CAR_KINDS, charFrame, type Dir } from '../../art/actorArt';
import { ATLAS, SCALE } from '../../art/atlas';
import { EMPLOYEES } from '../../data';
import { DEPTH } from './ShopViews';

const BUBBLE_SECONDS = 3.2;
const MAX_BUBBLES = 36;

interface Bubble {
  text: Phaser.GameObjects.Text;
  /** Customer to follow, or -1 for a fixed world position. */
  id: number;
  x: number;
  y: number;
  ttl: number;
  rise: number;
}

/** Draws pedestrians, their thought bubbles and sale pop-ups. */
export class NpcViews {
  private sprites = new Map<number, Phaser.GameObjects.Image>();
  private staffSprites = new Map<number, Phaser.GameObjects.Image>();
  private carSprites = new Map<number, Phaser.GameObjects.Image>();
  private bubbles: Bubble[] = [];
  private motion = new Map<string, { x: number; y: number; dir: Dir; phase: number; still: number }>();
  private ring: Phaser.GameObjects.Graphics;
  private offs: (() => void)[];

  constructor(private scene: Phaser.Scene) {
    this.ring = scene.add.graphics().setDepth(DEPTH.npcs + 3);
    this.offs = [
      bus.on('npc:removed', (id) => {
        this.sprites.get(id)?.destroy();
        this.sprites.delete(id);
        this.motion.delete(`c${id}`);
      }),
      bus.on('staff:removed', (id) => {
        this.staffSprites.get(id)?.destroy();
        this.staffSprites.delete(id);
        this.motion.delete(`s${id}`);
      }),
      bus.on('car:removed', (id) => {
        const img = this.carSprites.get(id);
        if (img) img.destroy();
        this.carSprites.delete(id);
      }),
      bus.on('world:bubble', ({ x, y, text, kind }) => {
        this.addBubble({ id: -1, x: x * TILE, y: y * TILE, rise: 18 }, text, kind === 'bad' ? '#b3261e' : kind === 'good' ? '#1b7a4b' : '#2b3340', '#ffffff');
      }),
      bus.on('npc:thought', ({ id, text, kind }) => {
        if (kind === 'neutral' && id !== ui.selectedNpc) return;
        this.addBubble({ id, x: 0, y: 0, rise: 0 }, text, kind === 'bad' ? '#b3261e' : kind === 'good' ? '#1b7a4b' : '#2b3340', '#ffffff');
      }),
      bus.on('sale', ({ amount, x, y }) => {
        this.addBubble({ id: -1, x: (x + 0.5) * TILE, y: y * TILE, rise: 26 }, `+${money(amount)}`, '#8fd16a', '#10141c');
      }),
    ];
  }

  destroy(): void {
    this.offs.forEach((off) => off());
  }

  /**
   * Point a walking sprite the way it is moving and step its walk cycle.
   * `key` identifies the mover so its last position and facing are remembered between frames.
   */
  private animate(img: Phaser.GameObjects.Image, key: string, base: number, x: number, y: number, realDt: number): void {
    let m = this.motion.get(key);
    if (!m) this.motion.set(key, (m = { x, y, dir: 'down', phase: 0, still: 0 }));
    const dx = x - m.x;
    const dy = y - m.y;
    const moved = Math.abs(dx) + Math.abs(dy) > 0.002;
    if (moved) {
      // Prefer the dominant axis so diagonal walkers do not flicker between facings.
      m.dir = Math.abs(dx) > Math.abs(dy) * 1.2 ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      m.phase += realDt * 7;
      m.still = 0;
    } else m.still += realDt;
    m.x = x;
    m.y = y;
    // Two walk frames alternate; standing still for a moment returns to the idle frame.
    const frame = m.still > 0.15 ? 0 : 1 + (Math.floor(m.phase) % 2);
    img.setFrame(charFrame(base, m.dir, frame));
    img.setPosition(x * TILE, y * TILE);
    img.setDepth(DEPTH.npcs + y / 1000);
  }

  private addBubble(anchor: { id: number; x: number; y: number; rise: number }, text: string, color: string, bg: string): void {
    if (this.scene.cameras.main.zoom < 0.55) return;
    // One bubble per person: a new thought replaces the old one.
    if (anchor.id >= 0) this.bubbles.filter((b) => b.id === anchor.id).forEach((b) => (b.ttl = 0));
    if (this.bubbles.length >= MAX_BUBBLES) return;
    const obj = this.scene.add
      .text(0, 0, text, { fontFamily: 'system-ui, "Segoe UI", sans-serif', fontSize: '12px', color, backgroundColor: bg, padding: { x: 5, y: 2 }, fontStyle: 'bold' })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.bubbles);
    this.bubbles.push({ text: obj, ttl: BUBBLE_SECONDS, ...anchor });
  }

  pickStaff(wx: number, wy: number): number | null {
    for (const a of rt.staff.values()) if (Math.hypot(a.x - wx / TILE, a.y - wy / TILE) < 0.5) return a.id;
    return null;
  }

  /** The pedestrian under a world position, if any. */
  pick(wx: number, wy: number): number | null {
    let best: number | null = null;
    let bestD = 0.55;
    for (const c of rt.customers) {
      const d = Math.hypot(c.x + c.ox - wx / TILE, c.y + c.oy - wy / TILE);
      if (d < bestD) {
        bestD = d;
        best = c.id;
      }
    }
    return best;
  }

  update(realDt: number): void {
    for (const c of rt.customers) {
      let img = this.sprites.get(c.id);
      if (!img) {
        img = this.scene.add.image(0, 0, ATLAS, charFrame(c.look, 'down', 0)).setScale(SCALE).setOrigin(0.5, 0.75);
        this.sprites.set(c.id, img);
      }
      this.animate(img, `c${c.id}`, c.look, c.x + c.ox, c.y + c.oy, realDt);
    }

    // A small badge in the role's colour floats over each employee so staff stand out from customers.
    const badges: { x: number; y: number; color: number }[] = [];
    for (const a of rt.staff.values()) {
      let img = this.staffSprites.get(a.id);
      if (!img) {
        img = this.scene.add.image(0, 0, ATLAS, charFrame(0, 'down', 0)).setScale(SCALE).setOrigin(0.5, 0.75);
        this.staffSprites.set(a.id, img);
      }
      const person = session.state.staff.find((e) => e.id === a.id);
      // Mechanics get the hard-hat character; everyone else keeps the look they were hired with.
      this.animate(img, `s${a.id}`, person?.role === 'mechanic' ? 3 : person?.look ?? 0, a.x, a.y, realDt);
      if (person) badges.push({ x: a.x * TILE, y: a.y * TILE - 30, color: Phaser.Display.Color.HexStringToColor(EMPLOYEES.roles[person.role]?.color ?? '#ffffff').color });
    }

    for (const car of rt.cars) {
      let img = this.carSprites.get(car.id);
      if (!img) {
        img = this.scene.add.image(0, 0, ATLAS, carFrame('red', 'right')).setScale(SCALE).setOrigin(0.5, 0.7);
        this.carSprites.set(car.id, img);
      }
      // Keep to the right-hand side of the road while driving.
      const lane = car.state === 'drive' ? 0.5 : 0;
      const cx = car.x - Math.sin(car.heading) * lane;
      const cy = car.y + Math.cos(car.heading) * lane;
      // Four drawn views: pick the one nearest the heading.
      const c = Math.cos(car.heading);
      const s = Math.sin(car.heading);
      const dir: Dir = Math.abs(c) >= Math.abs(s) ? (c >= 0 ? 'right' : 'left') : s >= 0 ? 'down' : 'up';
      const kind = car.look === 99 ? 'white' : CAR_KINDS[car.look % CAR_KINDS.length];
      img.setFrame(carFrame(kind, dir)).setPosition(cx * TILE, cy * TILE).setDepth(DEPTH.npcs + 1 + cy / 1000);
    }

    this.ring.clear();
    for (const b of badges) this.ring.fillStyle(0x10141c, 1).fillRect(b.x - 5, b.y - 1, 10, 8).fillStyle(b.color, 1).fillRect(b.x - 3, b.y + 1, 6, 4);
    const sel = ui.selectedNpc !== null ? rt.byId.get(ui.selectedNpc) : undefined;
    if (sel) this.ring.lineStyle(2, 0xffffff, 1).strokeCircle((sel.x + sel.ox) * TILE, (sel.y + sel.oy) * TILE, 12);
    const selStaff = ui.selectedStaff !== null ? rt.staff.get(ui.selectedStaff) : undefined;
    if (selStaff) this.ring.lineStyle(2, 0xffffff, 1).strokeCircle(selStaff.x * TILE, selStaff.y * TILE, 13);

    // Bubbles keep a constant on-screen size so they stay readable at any zoom.
    const scale = 1 / Math.max(0.55, this.scene.cameras.main.zoom);
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.ttl -= realDt;
      const c = b.id >= 0 ? rt.byId.get(b.id) : undefined;
      if (b.ttl <= 0 || (b.id >= 0 && !c)) {
        b.text.destroy();
        this.bubbles.splice(i, 1);
        continue;
      }
      const lift = b.rise * (1 - b.ttl / BUBBLE_SECONDS);
      if (c) b.text.setPosition((c.x + c.ox) * TILE, (c.y + c.oy) * TILE - 22);
      else b.text.setPosition(b.x, b.y - lift);
      b.text.setScale(scale).setAlpha(Math.min(1, b.ttl * 2));
    }
  }
}
