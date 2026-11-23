import Phaser from 'phaser';
import { TILE } from '../../core/constants';
import { bus } from '../../core/events';
import { money } from '../../core/format';
import { ui } from '../../core/uiState';
import { rt } from '../../systems/ai/runtime';
import { session } from '../../core/state';
import { EMPLOYEES } from '../../data';
import { DEPTH } from './ShopViews';

const SHIRTS = ['#d9534f', '#5aa9e6', '#f2b84b', '#7cc576', '#b07cc6', '#e8edf5', '#3d4450', '#e58f4f'];
const SKINS = ['#f1d3b3', '#c99a6b', '#8a5a3c'];
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
  private ring: Phaser.GameObjects.Graphics;
  private offs: (() => void)[];

  constructor(private scene: Phaser.Scene) {
    this.makeTextures();
    this.ring = scene.add.graphics().setDepth(DEPTH.npcs - 1);
    this.offs = [
      bus.on('npc:removed', (id) => {
        this.sprites.get(id)?.destroy();
        this.sprites.delete(id);
      }),
      bus.on('staff:removed', (id) => {
        this.staffSprites.get(id)?.destroy();
        this.staffSprites.delete(id);
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

  /** Procedural people: a shirt-coloured body with a head. Replace `npc_<n>` textures to reskin. */
  private makeTextures(): void {
    for (let i = 0; i < SHIRTS.length * SKINS.length; i++) {
      const key = `npc_${i}`;
      if (this.scene.textures.exists(key)) continue;
      const tex = this.scene.textures.createCanvas(key, 22, 22)!;
      const ctx = tex.getContext();
      const shirt = SHIRTS[i % SHIRTS.length];
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(12, 13, 8, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1c222c';
      ctx.beginPath();
      ctx.arc(11, 11, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = shirt;
      ctx.beginPath();
      ctx.arc(11, 11, 6.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = SKINS[Math.floor(i / SHIRTS.length)];
      ctx.beginPath();
      ctx.arc(11, 10, 4, 0, Math.PI * 2);
      ctx.fill();
      tex.refresh();
    }
  }

  /** Staff wear their role colour with a dark cap so they stand out from customers. */
  private staffTexture(role: string): string {
    const key = `staff_${role}`;
    if (this.scene.textures.exists(key)) return key;
    const tex = this.scene.textures.createCanvas(key, 24, 24)!;
    const ctx = tex.getContext();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(13, 14, 9, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(12, 12, 9.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = EMPLOYEES.roles[role]?.color ?? '#4fc3a1';
    ctx.beginPath();
    ctx.arc(12, 12, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f1d3b3';
    ctx.beginPath();
    ctx.arc(12, 11, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#20262f';
    ctx.beginPath();
    ctx.arc(12, 10, 4.5, Math.PI, 0);
    ctx.fill();
    tex.refresh();
    return key;
  }

  /** Cars point right in their texture and are rotated to their heading. Look 99 is the delivery van. */
  private carTexture(look: number): string {
    const key = `car_${look}`;
    if (this.scene.textures.exists(key)) return key;
    const van = look === 99;
    const w = van ? 34 : 28;
    const tex = this.scene.textures.createCanvas(key, w + 4, 20)!;
    const ctx = tex.getContext();
    const body = van ? '#f2f2f2' : ['#d9534f', '#5aa9e6', '#f2b84b', '#e8edf5', '#3d4450', '#7cc576'][look % 6];
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.roundRect(3, 4, w, 14, 4);
    ctx.fill();
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.roundRect(1, 2, w, 14, 4);
    ctx.fill();
    ctx.fillStyle = '#20262f';
    ctx.fillRect(w - 9, 4, 5, 10);
    if (van) {
      ctx.fillStyle = '#d9534f';
      ctx.fillRect(5, 5, 14, 8);
    } else ctx.fillRect(5, 4, 4, 10);
    tex.refresh();
    return key;
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
        img = this.scene.add.image(0, 0, `npc_${c.look}`).setDepth(DEPTH.npcs);
        this.sprites.set(c.id, img);
      }
      img.setPosition((c.x + c.ox) * TILE, (c.y + c.oy) * TILE);
    }

    for (const a of rt.staff.values()) {
      let img = this.staffSprites.get(a.id);
      if (!img) {
        const role = session.state.staff.find((e) => e.id === a.id)?.role ?? 'cashier';
        img = this.scene.add.image(0, 0, this.staffTexture(role)).setDepth(DEPTH.npcs + 1);
        this.staffSprites.set(a.id, img);
      }
      img.setPosition(a.x * TILE, a.y * TILE);
    }

    for (const car of rt.cars) {
      let img = this.carSprites.get(car.id);
      if (!img) {
        img = this.scene.add.image(0, 0, this.carTexture(car.look)).setDepth(DEPTH.npcs + 2);
        this.carSprites.set(car.id, img);
      }
      // Keep to the right-hand side of the road while driving.
      const lane = car.state === 'drive' ? 0.5 : 0;
      img.setPosition((car.x - Math.sin(car.heading) * lane) * TILE, (car.y + Math.cos(car.heading) * lane) * TILE);
      img.setRotation(car.heading);
    }

    this.ring.clear();
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
      if (c) b.text.setPosition((c.x + c.ox) * TILE, (c.y + c.oy) * TILE - 12);
      else b.text.setPosition(b.x, b.y - lift);
      b.text.setScale(scale).setAlpha(Math.min(1, b.ttl * 2));
    }
  }
}
