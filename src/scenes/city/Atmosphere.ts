import Phaser from 'phaser';
import { ATLAS } from '../../art/atlas';
import { LIGHT_TEX } from '../../art/fxArt';
import { TILE } from '../../core/constants';
import { quality } from '../../core/settings';
import { session } from '../../core/state';
import { NEIGHBORHOODS } from '../../data';
import { defOf } from '../../entities/Shop';
import { rt } from '../../systems/ai/runtime';
import { isOpenNow } from '../../systems/shop/status';
import { darkness, hourFloat } from '../../systems/time/clock';
import { DEPTH } from './ShopViews';

/** A point light in world pixels. `rx`/`ry` are radii; `strength` 0-1 is how much darkness it removes. */
export interface Light {
  x: number;
  y: number;
  rx: number;
  ry: number;
  strength: number;
}

/** Pixel size of the light texture, for scaling stamps. */
const LIGHT_SIZE = 128;
const NIGHT = 0x0a1238;
const DUSK = 0x4a2a52;
const OVERCAST = 0x4a5566;

const mix = (a: number, b: number, t: number): number => {
  const ch = (s: number): number => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

/**
 * Day/night, lights and weather.
 *
 * Darkness is a layer drawn over the world; every light source punches a soft hole in it,
 * so lit windows, street lamps and open shops show at full brightness while the rest of the
 * city falls into blue night. Weather adds its own tint and particles on top.
 * On the Low graphics setting only a flat tint is used.
 */
export class Atmosphere {
  private dark: Phaser.GameObjects.RenderTexture | null = null;
  private fog: Phaser.GameObjects.Rectangle;
  private rain: Phaser.GameObjects.Particles.ParticleEmitter;
  private snow: Phaser.GameObjects.Particles.ParticleEmitter;
  private res = 0;
  /** Extra lights supplied by other renderers this frame (street lamps, signals). */
  readonly extra: Light[] = [];

  constructor(private scene: Phaser.Scene) {
    this.fog = scene.add.rectangle(0, 0, 10, 10, 0xdfe6ee, 0).setOrigin(0).setDepth(DEPTH.ghost + 2);
    this.rain = scene.add.particles(0, 0, ATLAS, {
      frame: 'fx:rain', lifespan: 700, speedY: { min: 900, max: 1150 }, speedX: { min: -160, max: -110 },
      scale: 2, alpha: { start: 0.75, end: 0.4 }, emitting: false,
    }).setDepth(DEPTH.ghost + 3);
    this.snow = scene.add.particles(0, 0, ATLAS, {
      frame: 'fx:snow', lifespan: 5200, speedY: { min: 55, max: 120 }, speedX: { min: -40, max: 40 },
      scale: { min: 1, max: 2.5 }, alpha: { start: 0.95, end: 0.5 }, emitting: false,
    }).setDepth(DEPTH.ghost + 3);
  }

  /** How dark it is right now, 0 (day) to 1 (deep night). Other renderers use it to switch lamps on. */
  get night(): number {
    return darkness(hourFloat(session.state.time));
  }

  private ensureLayer(view: Phaser.Geom.Rectangle): void {
    const q = quality();
    const cam = this.scene.cameras.main;
    const w = Math.max(64, Math.ceil(cam.width * q.lightRes));
    const h = Math.max(64, Math.ceil(cam.height * q.lightRes));
    if (!this.dark || this.res !== q.lightRes || this.dark.width !== w || this.dark.height !== h) {
      this.dark?.destroy();
      this.dark = this.scene.add.renderTexture(0, 0, w, h).setOrigin(0).setDepth(DEPTH.ghost + 1);
      this.res = q.lightRes;
    }
    this.dark.setPosition(view.x, view.y).setDisplaySize(view.width, view.height).setVisible(true);
  }

  /** Lights that come from the simulation itself: open shops, lamps inside them, cars, lit windows. */
  private collect(view: Phaser.Geom.Rectangle, out: Light[]): void {
    const s = session.state;
    const { city } = session;
    const pad = 6 * TILE;
    const inView = (x: number, y: number): boolean => x > view.x - pad && x < view.right + pad && y > view.y - pad && y < view.bottom + pad;

    for (const shop of s.shops) {
      const lot = city.lots[shop.lotId];
      const cx = (lot.x + lot.w / 2) * TILE;
      const cy = (lot.y + lot.h / 2) * TILE;
      if (inView(cx, cy) || inView(lot.x * TILE, lot.y * TILE) || inView((lot.x + lot.w) * TILE, (lot.y + lot.h) * TILE)) {
        // An open shop has its lights on; a closed one is dark except for any lamps you placed.
        if (isOpenNow(s, shop)) out.push({ x: cx, y: cy, rx: lot.w * TILE * 0.8, ry: lot.h * TILE * 0.8, strength: 0.95 });
      }
      for (const o of shop.objects) {
        const d = defOf(o);
        const glow = d.light ?? (d.kind === 'vending' ? 1.6 : 0);
        if (!glow) continue;
        const x = (o.x + 0.5) * TILE;
        const y = (o.y + 0.5) * TILE;
        if (inView(x, y)) out.push({ x, y, rx: glow * TILE, ry: glow * TILE, strength: 0.9 });
      }
    }

    // Windows of other buildings: most are lit in the evening, fewer in the small hours.
    const hour = hourFloat(s.time);
    const awake = hour >= 5.5 && hour < 23 ? 0.7 : 0.18;
    for (const lot of city.lots) {
      if (lot.rentable || lot.front !== 's') continue;
      const y = (lot.y + lot.h - 0.5) * TILE;
      if (!inView((lot.x + lot.w / 2) * TILE, y)) continue;
      const door = Math.floor(lot.w / 2);
      for (let x = 0; x < lot.w; x++) {
        if (x === door || x % 2 === door % 2) continue;
        // Each window keeps its own habits.
        if (((lot.id * 31 + x * 17) % 100) / 100 < awake) out.push({ x: (lot.x + x + 0.5) * TILE, y, rx: TILE * 0.8, ry: TILE * 0.8, strength: NEIGHBORHOODS[lot.district].buildingStyle === 'office' ? 0.75 : 0.9 });
      }
    }

    for (const car of rt.cars) {
      const x = (car.x + Math.cos(car.heading) * 0.9) * TILE;
      const y = (car.y + Math.sin(car.heading) * 0.9) * TILE;
      if (car.state !== 'parked' && inView(x, y)) out.push({ x, y, rx: TILE * 1.7, ry: TILE * 1.7, strength: 0.8 });
    }
  }

  /** Call every frame after the camera has moved. */
  update(): void {
    const s = session.state;
    const q = quality();
    const cam = this.scene.cameras.main;
    const view = cam.worldView;
    const weather = s.weather.kind;
    const night = this.night;
    const gloomy = weather === 'rain' || weather === 'snow' || weather === 'fog' ? 0.22 : weather === 'cloudy' ? 0.1 : 0;

    // ---- Darkness and colour grade ----
    const alpha = Math.max(night * 0.72, gloomy);
    if (!q.lights || alpha < 0.02) {
      this.dark?.setVisible(false);
    } else {
      this.ensureLayer(view);
      const dark = this.dark!;
      // Dusk and dawn are warm and purple; full night is blue; daytime gloom is grey.
      const color = night > 0.02 ? mix(DUSK, NIGHT, Math.min(1, night * 1.6)) : OVERCAST;
      dark.clear().fill(color, alpha);
      if (night > 0.08) {
        const lights: Light[] = [...this.extra];
        this.collect(view, lights);
        const k = dark.width / view.width;
        for (const l of lights) {
          // Commands are queued and run later, so each light is passed by value, not through a shared object.
          dark.stamp(LIGHT_TEX, undefined, (l.x - view.x) * k, (l.y - view.y) * k, { blendMode: Phaser.BlendModes.ERASE, alpha: l.strength, scaleX: (l.rx * 2 * k) / LIGHT_SIZE, scaleY: (l.ry * 2 * k) / LIGHT_SIZE });
        }
      }
      // Drawing commands are queued; this runs them.
      dark.render();
    }
    this.extra.length = 0;

    // ---- Weather ----
    const density = q.weather * (cam.width * cam.height) / (1280 * 720);
    const top = view.y - 40;
    if (weather === 'rain' && s.time.speed > 0) {
      const n = Math.round(9 * density);
      for (let i = 0; i < n; i++) this.rain.emitParticleAt(view.x + Math.random() * (view.width + 160), top + Math.random() * view.height * 0.5, 1);
    }
    if (weather === 'snow' && s.time.speed > 0) {
      const n = Math.random() < 3 * density ? Math.ceil(density) : 0;
      for (let i = 0; i < n; i++) this.snow.emitParticleAt(view.x + Math.random() * view.width, top + Math.random() * view.height, 1);
    }
    const fogAlpha = weather === 'fog' ? 0.3 : weather === 'snow' ? 0.08 : 0;
    this.fog.setPosition(view.x, view.y).setSize(view.width, view.height).setFillStyle(0xdfe6ee, fogAlpha).setVisible(fogAlpha > 0);
  }

  /** A flat tint for the Low setting, where the light layer is off. 0 means none. */
  flatTint(): number {
    return quality().lights ? 0 : this.night * 0.55;
  }

  destroy(): void {
    this.dark?.destroy();
  }
}
