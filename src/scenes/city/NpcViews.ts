import Phaser from 'phaser';
import { carFrame, CAR_KINDS, charFrame, type Dir, LOOKS } from '../../art/actorArt';
import { ATLAS, SCALE } from '../../art/atlas';
import { TILE } from '../../core/constants';
import { bus } from '../../core/events';
import { money } from '../../core/format';
import { quality } from '../../core/settings';
import { session, shopById } from '../../core/state';
import { ui } from '../../core/uiState';
import { EMPLOYEES, SHOP_TYPES } from '../../data';
import type { Customer } from '../../entities/Customer';
import { defOf } from '../../entities/Shop';
import { rt } from '../../systems/ai/runtime';
import { BUS_LOOK, VAN_LOOK } from '../../systems/ai/vehicles';
import { DEPTH } from './ShopViews';

const BUBBLE_SECONDS = 3.2;
const MAX_BUBBLES = 36;
/** World pixels beyond the screen edge where sprites are still drawn. */
const CULL_MARGIN = 3 * TILE;

interface Bubble {
  text: Phaser.GameObjects.Text;
  /** Customer to follow, or -1 for a fixed world position. */
  id: number;
  x: number;
  y: number;
  ttl: number;
  rise: number;
}

interface Motion {
  x: number;
  y: number;
  dir: Dir;
  phase: number;
  still: number;
}

/**
 * Draws pedestrians, staff and vehicles from atlas frames, plus thought bubbles, emotes
 * and sale pop-ups. Sprites are pooled (never created and destroyed per person) and
 * anything off screen is hidden and skipped, which is what keeps 300+ people cheap.
 */
export class NpcViews {
  private sprites = new Map<number, Phaser.GameObjects.Image>();
  private staffSprites = new Map<number, Phaser.GameObjects.Image>();
  private carSprites = new Map<number, Phaser.GameObjects.Image>();
  private pool: Phaser.GameObjects.Image[] = [];
  private emotes = new Map<number, Phaser.GameObjects.Image>();
  private emotePool: Phaser.GameObjects.Image[] = [];
  /** Emote shown because of a recent thought: name and seconds left. */
  private flash = new Map<number, { name: string; ttl: number }>();
  private motion = new Map<string, Motion>();
  /** Sprites for the people walking with a customer, keyed by customer id * 8 + position in the group. */
  private followers = new Map<number, Phaser.GameObjects.Image>();
  /** Recent positions of each group leader, newest first, for companions to trail along. */
  private trails = new Map<number, { x: number; y: number }[]>();
  private bubbles: Bubble[] = [];
  private ring: Phaser.GameObjects.Graphics;
  private offs: (() => void)[];
  /** How many people were actually drawn last frame, for the performance readout. */
  drawn = 0;

  constructor(private scene: Phaser.Scene) {
    this.ring = scene.add.graphics().setDepth(DEPTH.npcs + 3);
    const tone = (kind: string): string => (kind === 'bad' ? '#b3261e' : kind === 'good' ? '#1b7a4b' : '#2b3340');
    this.offs = [
      bus.on('npc:removed', (id) => {
        this.release(this.sprites, id);
        this.motion.delete(`c${id}`);
        for (let i = 0; i < 8; i++) {
          this.release(this.followers, id * 8 + i);
          this.motion.delete(`f${id * 8 + i}`);
        }
        this.trails.delete(id);
        this.flash.delete(id);
        this.dropEmote(id);
      }),
      bus.on('staff:removed', (id) => {
        this.release(this.staffSprites, id);
        this.motion.delete(`s${id}`);
      }),
      bus.on('car:removed', (id) => this.release(this.carSprites, id)),
      bus.on('world:bubble', ({ x, y, text, kind }) => this.addBubble({ id: -1, x: x * TILE, y: y * TILE, rise: 18 }, text, tone(kind), '#ffffff')),
      bus.on('npc:thought', ({ id, text, kind }) => {
        if (kind !== 'neutral') this.flash.set(id, { name: kind === 'good' ? 'happy' : 'angry', ttl: 2.2 });
        if (kind === 'neutral' && id !== ui.selectedNpc) return;
        this.addBubble({ id, x: 0, y: 0, rise: 0 }, text, tone(kind), '#ffffff');
      }),
      bus.on('sale', ({ amount, x, y }) => this.addBubble({ id: -1, x: (x + 0.5) * TILE, y: y * TILE, rise: 30 }, `+${money(amount)}`, '#b9f58a', '#10141c')),
    ];
  }

  destroy(): void {
    this.offs.forEach((off) => off());
  }

  /** Take a sprite from the pool, or make one if the pool is empty. */
  private acquire(map: Map<number, Phaser.GameObjects.Image>, id: number, frame: string): Phaser.GameObjects.Image {
    let img = map.get(id);
    if (img) return img;
    img = this.pool.pop() ?? this.scene.add.image(0, 0, ATLAS, frame);
    img.setFrame(frame).setVisible(true).setScale(SCALE).setFlipX(false).setAlpha(1);
    map.set(id, img);
    return img;
  }

  private release(map: Map<number, Phaser.GameObjects.Image>, id: number): void {
    const img = map.get(id);
    if (!img) return;
    img.setVisible(false);
    this.pool.push(img);
    map.delete(id);
  }

  private dropEmote(id: number): void {
    const e = this.emotes.get(id);
    if (!e) return;
    e.setVisible(false);
    this.emotePool.push(e);
    this.emotes.delete(id);
  }

  /**
   * Point a walking sprite the way it is moving and step its walk cycle.
   * `key` identifies the mover so its last position and facing are remembered between frames.
   */
  private animate(img: Phaser.GameObjects.Image, key: string, look: number, x: number, y: number, realDt: number, visible: boolean, sitting = false): void {
    let m = this.motion.get(key);
    if (!m) this.motion.set(key, (m = { x, y, dir: 'down', phase: 0, still: 0 }));
    const dx = x - m.x;
    const dy = y - m.y;
    if (Math.abs(dx) + Math.abs(dy) > 0.002) {
      // Prefer the dominant axis so diagonal walkers do not flicker between facings.
      m.dir = Math.abs(dx) > Math.abs(dy) * 1.2 ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      m.phase += realDt * 7;
      m.still = 0;
    } else m.still += realDt;
    m.x = x;
    m.y = y;
    img.setVisible(visible);
    if (!visible) return;
    // Two walk frames alternate; standing still for a moment returns to the idle frame.
    const frame = m.still > 0.15 ? 0 : 1 + (Math.floor(m.phase) % 2);
    const scale = SCALE * (LOOKS[look % LOOKS.length]?.scale ?? 1);
    img.setFrame(charFrame(look, sitting ? 'down' : m.dir, frame)).setScale(scale).setOrigin(0.5, 0.8);
    // Someone sitting is drawn a little lower, onto the seat.
    img.setPosition(x * TILE, y * TILE + (sitting ? 5 : 0));
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
    for (const a of rt.staff.values()) if (Math.hypot(a.x - wx / TILE, a.y - 0.3 - wy / TILE) < 0.6) return a.id;
    return null;
  }

  /** The pedestrian under a world position, if any. */
  pick(wx: number, wy: number): number | null {
    let best: number | null = null;
    let bestD = 0.6;
    for (const c of rt.customers) {
      // Sprites stand above their ground position, so aim a little higher than the feet.
      const d = Math.hypot(c.x + c.ox - wx / TILE, c.y + c.oy - 0.3 - wy / TILE);
      if (d < bestD) {
        bestD = d;
        best = c.id;
      }
    }
    return best;
  }

  /** What a customer is visibly doing, as an emote name, or null. */
  private statusEmote(c: Customer): string | null {
    if (c.state === 'queue' && c.waited > 3) return 'wait';
    if (c.state === 'awaitOrder') return c.waited > 4 ? 'wait' : null;
    if (c.state === 'waitStation') return 'wait';
    if (c.state === 'using' && c.bought && c.stationId >= 0) {
      // Sitting down in a restaurant or café after ordering means they are eating.
      const shop = c.shopId !== null ? shopById(session.state, c.shopId) : undefined;
      const obj = shop?.objects.find((o) => o.id === c.stationId);
      if (shop && obj && defOf(obj).kind === 'seat' && SHOP_TYPES[shop.type].flow === 'counter') return 'food';
    }
    if (c.cart.length) return 'bag';
    return null;
  }

  update(realDt: number): void {
    const cam = this.scene.cameras.main;
    const v = cam.worldView;
    const x0 = (v.x - CULL_MARGIN) / TILE;
    const x1 = (v.right + CULL_MARGIN) / TILE;
    const y0 = (v.y - CULL_MARGIN) / TILE;
    const y1 = (v.bottom + CULL_MARGIN) / TILE;
    const showEmotes = cam.zoom >= 0.9 && quality().particles > 0;
    let drawn = 0;

    for (const c of rt.customers) {
      const x = c.x + c.ox;
      const y = c.y + c.oy;
      const visible = x > x0 && x < x1 && y > y0 && y < y1;
      const img = this.acquire(this.sprites, c.id, charFrame(c.look, 'down', 0));
      const sitting = c.state === 'using' && (c.seatId >= 0 || this.statusEmote(c) === 'food');
      this.animate(img, `c${c.id}`, c.look, x, y, realDt, visible, sitting);
      if (visible) drawn++;

      // Companions walk a few steps behind, following the path the leader actually took.
      if (c.companions.length) {
        let trail = this.trails.get(c.id);
        if (!trail) this.trails.set(c.id, (trail = [{ x, y }]));
        if (Math.hypot(trail[0].x - x, trail[0].y - y) > 0.22) {
          trail.unshift({ x, y });
          if (trail.length > 16) trail.pop();
        }
        c.companions.forEach((look, i) => {
          const at = trail[Math.min(trail.length - 1, (i + 1) * 3)];
          // Standing still, the group bunches up beside the leader instead of in a line.
          const fx = at.x + (trail.length < 3 ? (i + 1) * 0.45 : 0);
          const key = c.id * 8 + i;
          this.animate(this.acquire(this.followers, key, charFrame(look, 'down', 0)), `f${key}`, look, fx, at.y, realDt, visible);
          if (visible) drawn++;
        });
      }

      // Emote above the head: a recent strong feeling wins over what they are doing.
      const f = this.flash.get(c.id);
      if (f && (f.ttl -= realDt) <= 0) this.flash.delete(c.id);
      const name = visible && showEmotes ? (this.flash.get(c.id)?.name ?? this.statusEmote(c)) : null;
      if (!name) this.dropEmote(c.id);
      else {
        let e = this.emotes.get(c.id);
        if (!e) {
          e = this.emotePool.pop() ?? this.scene.add.image(0, 0, ATLAS, `emote:${name}`).setScale(SCALE).setOrigin(0.5, 1);
          e.setVisible(true);
          this.emotes.set(c.id, e);
        }
        e.setFrame(`emote:${name}`).setPosition(x * TILE, y * TILE - 26).setDepth(DEPTH.npcs + 2);
      }
    }

    // A small badge in the role's colour floats over each employee so staff stand out from customers.
    this.ring.clear();
    for (const a of rt.staff.values()) {
      const person = session.state.staff.find((e) => e.id === a.id);
      const visible = a.x > x0 && a.x < x1 && a.y > y0 && a.y < y1;
      // Mechanics get the hard-hat character; everyone else keeps the look they were hired with.
      const look = person?.role === 'mechanic' ? 3 : person?.look ?? 0;
      const img = this.acquire(this.staffSprites, a.id, charFrame(look, 'down', 0));
      this.animate(img, `s${a.id}`, look, a.x, a.y, realDt, visible);
      if (visible && person) {
        const color = Phaser.Display.Color.HexStringToColor(EMPLOYEES.roles[person.role]?.color ?? '#ffffff').color;
        this.ring.fillStyle(0x10141c, 1).fillRect(a.x * TILE - 5, a.y * TILE - 33, 10, 8).fillStyle(color, 1).fillRect(a.x * TILE - 3, a.y * TILE - 31, 6, 4);
      }
    }

    for (const car of rt.cars) {
      // Keep to the right-hand side of the road while driving; parked cars sit at the kerb.
      const lane = car.state === 'drive' ? 0.5 : car.state === 'parked' ? 1.05 : 0;
      const cx = car.x - Math.sin(car.heading) * lane;
      const cy = car.y + Math.cos(car.heading) * lane;
      const visible = cx > x0 - 2 && cx < x1 + 2 && cy > y0 - 2 && cy < y1 + 2;
      const img = this.acquire(this.carSprites, car.id, carFrame('red', 'right'));
      img.setVisible(visible);
      if (!visible) continue;
      // Four drawn views: pick the one nearest the heading.
      const c = Math.cos(car.heading);
      const s = Math.sin(car.heading);
      const dir: Dir = Math.abs(c) >= Math.abs(s) ? (c >= 0 ? 'right' : 'left') : s >= 0 ? 'down' : 'up';
      const kind = car.look === VAN_LOOK ? 'van' : car.look === BUS_LOOK ? 'bus' : CAR_KINDS[car.look % CAR_KINDS.length];
      img.setFrame(carFrame(kind, dir)).setScale(SCALE).setOrigin(0.5, 0.7).setPosition(cx * TILE, cy * TILE).setDepth(DEPTH.npcs + 1 + cy / 1000);
    }
    this.drawn = drawn;

    const sel = ui.selectedNpc !== null ? rt.byId.get(ui.selectedNpc) : undefined;
    if (sel) this.ring.lineStyle(2, 0xffffff, 1).strokeEllipse((sel.x + sel.ox) * TILE, (sel.y + sel.oy) * TILE + 2, 26, 12);
    const selStaff = ui.selectedStaff !== null ? rt.staff.get(ui.selectedStaff) : undefined;
    if (selStaff) this.ring.lineStyle(2, 0xffffff, 1).strokeEllipse(selStaff.x * TILE, selStaff.y * TILE + 2, 26, 12);

    // Bubbles keep a constant on-screen size so they stay readable at any zoom.
    const scale = 1 / Math.max(0.55, cam.zoom);
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
      if (c) b.text.setPosition((c.x + c.ox) * TILE, (c.y + c.oy) * TILE - 36);
      else b.text.setPosition(b.x, b.y - lift);
      b.text.setScale(scale).setAlpha(Math.min(1, b.ttl * 2));
    }
  }
}
