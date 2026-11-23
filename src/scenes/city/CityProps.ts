import Phaser from 'phaser';
import { seasonOf } from '../../systems/world/seasons';
import { bus } from '../../core/events';
import { ATLAS, SCALE } from '../../art/atlas';
import { TILE } from '../../core/constants';
import { quality } from '../../core/settings';
import { session } from '../../core/state';
import { idx, T } from '../../systems/city/generate';
import { greenAxis, trafficSignals } from '../../systems/ai/vehicles';
import type { Atmosphere } from './Atmosphere';
import { DEPTH } from './ShopViews';

interface Bird {
  img: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  phase: number;
}

/**
 * Street furniture and small signs of life that are not part of the simulation:
 * lamp posts that come on at dusk, traffic signals that show the real light state,
 * trees that sway, and birds crossing the sky.
 */
export class CityProps {
  private lamps: Phaser.GameObjects.Image[] = [];
  private signals: { img: Phaser.GameObjects.Image; index: number }[] = [];
  private trees: { img: Phaser.GameObjects.Image; kind: number; phase: number }[] = [];
  private birds: Bird[] = [];
  private clock = 0;
  private lampsLit = false;

  /** Foliage follows the season: green, deeper green, amber, then frosted. */
  private tintTrees(): void {
    const season = seasonOf(session.state);
    // Tints multiply, so the summer green is left as drawn and the others are pulled toward their colour.
    const tint = season.id === 'spring' ? 0xdfffd9 : season.id === 'summer' ? 0xffffff : Phaser.Display.Color.HexStringToColor(season.id === 'autumn' ? '#ffb46a' : '#bfe0f0').color;
    for (const t of this.trees) if (t.img.scene) t.img.setTint(tint);
  }

  constructor(private scene: Phaser.Scene, private atmosphere: Atmosphere) {
    const { city } = session;
    const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= city.w || y >= city.h ? -1 : city.tiles[idx(city, x, y)]);
    const road = (v: number): boolean => v === T.Road || v === T.Crosswalk;

    for (let y = 0; y < city.h; y++) {
      for (let x = 0; x < city.w; x++) {
        const t = at(x, y);
        if (t === T.Tree) {
          const kind = (x * 7 + y * 13) % 3;
          const img = scene.add.image(x * TILE, y * TILE, ATLAS, `tree:${kind}:0`).setOrigin(0).setScale(SCALE).setDepth(DEPTH.objects + y / 1000);
          this.trees.push({ img, kind, phase: (x * 3 + y * 5) % 7 });
        }
        if (t !== T.Sidewalk) continue;
        // Lamp posts along the kerb, spaced out and never at a crossing.
        const kerbN = road(at(x, y - 1)) && at(x, y - 1) === T.Road;
        const kerbW = road(at(x - 1, y)) && at(x - 1, y) === T.Road;
        if ((kerbN && x % 9 === 4) || (kerbW && y % 9 === 6)) {
          this.lamps.push(scene.add.image(x * TILE, (y - 1) * TILE, ATLAS, 'prop:lamp').setOrigin(0).setScale(SCALE).setDepth(DEPTH.npcs + y / 1000));
        } else if (kerbN && x % 23 === 11) {
          // A scattering of other street furniture.
          const frame = ['prop:hydrant', 'prop:mailbox', 'prop:bin', 'prop:bench'][(x + y) % 4];
          scene.add.image(x * TILE, y * TILE, ATLAS, frame).setOrigin(0).setScale(SCALE).setDepth(DEPTH.objects + y / 1000);
        }
      }
    }

    for (const sig of trafficSignals()) {
      const img = scene.add.image(sig.x * TILE, sig.y * TILE, ATLAS, 'signal:off').setOrigin(0).setScale(SCALE).setDepth(DEPTH.npcs + sig.y / 1000);
      this.signals.push({ img, index: sig.index });
    }
    this.tintTrees();
    bus.on('season:changed', () => this.tintTrees());
  }

  update(realDt: number): void {
    const s = session.state;
    const q = quality();
    const view = this.scene.cameras.main.worldView;
    const night = this.atmosphere.night;

    // Lamps switch on at dusk and feed the lighting.
    const lit = night > 0.25;
    if (lit !== this.lampsLit) {
      this.lampsLit = lit;
      for (const l of this.lamps) l.setFrame(lit ? 'prop:lamp_lit' : 'prop:lamp');
    }
    if (lit) {
      for (const l of this.lamps) {
        if (l.x < view.x - 160 || l.x > view.right + 160 || l.y < view.y - 160 || l.y > view.bottom + 160) continue;
        this.atmosphere.extra.push({ x: l.x + 8, y: l.y + 44, rx: TILE * 3.4, ry: TILE * 3, strength: 0.92 });
      }
    }

    // Signals mirror the lights the cars are actually obeying.
    for (const sig of this.signals) {
      const axis = greenAxis(sig.index, s.time.minutes);
      // The post faces east-west traffic.
      sig.img.setFrame(axis === 'ew' ? 'signal:green' : axis === 'none' ? 'signal:amber' : 'signal:red');
      if (lit) this.atmosphere.extra.push({ x: sig.img.x + 16, y: sig.img.y + 16, rx: TILE * 0.9, ry: TILE * 0.9, strength: 0.7 });
    }

    if (!q.props || s.time.speed === 0) return;

    // Trees lean with the wind in a slow ripple; only the ones on screen are touched.
    this.clock += realDt;
    if (this.clock > 0.45) {
      this.clock = 0;
      const beat = Math.floor(this.scene.time.now / 450);
      const windy = s.weather.kind === 'rain' || s.weather.kind === 'snow' ? 2 : 4;
      for (const t of this.trees) {
        if (t.img.x < view.x - 40 || t.img.x > view.right + 40 || t.img.y < view.y - 40 || t.img.y > view.bottom + 40) continue;
        t.img.setFrame(`tree:${t.kind}:${(beat + t.phase) % windy === 0 ? 1 : 0}`);
      }
      // Birds: now and then a few cross the view by day in fair weather.
      if (this.birds.length < 6 && night < 0.2 && s.weather.kind !== 'rain' && s.weather.kind !== 'snow' && Math.random() < 0.12) this.spawnBirds(view);
    }

    for (let i = this.birds.length - 1; i >= 0; i--) {
      const b = this.birds[i];
      b.img.x += b.vx * realDt;
      b.img.y += b.vy * realDt;
      b.phase += realDt * 7;
      b.img.setFrame(`bird:${Math.floor(b.phase) % 2}`);
      if (b.img.x < view.x - 200 || b.img.x > view.right + 200 || b.img.y < view.y - 200 || b.img.y > view.bottom + 200) {
        b.img.destroy();
        this.birds.splice(i, 1);
      }
    }
  }

  private spawnBirds(view: Phaser.Geom.Rectangle): void {
    const fromLeft = Math.random() < 0.5;
    const y = view.y + Math.random() * view.height * 0.8;
    const vx = (fromLeft ? 1 : -1) * (110 + Math.random() * 60);
    const vy = -20 + Math.random() * 40;
    const flock = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < flock; i++) {
      const img = this.scene.add.image((fromLeft ? view.x - 30 : view.right + 30) - i * 18 * Math.sign(vx), y + i * 10, ATLAS, 'bird:0').setScale(SCALE).setDepth(DEPTH.ghost).setFlipX(!fromLeft);
      this.birds.push({ img, vx, vy, phase: i });
    }
  }
}
