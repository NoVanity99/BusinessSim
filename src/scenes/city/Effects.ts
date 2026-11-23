import Phaser from 'phaser';
import { ATLAS } from '../../art/atlas';
import { TILE } from '../../core/constants';
import { bus } from '../../core/events';
import { quality } from '../../core/settings';
import { session } from '../../core/state';
import { defOf, footprint } from '../../entities/Shop';
import { regKey, rt } from '../../systems/ai/runtime';
import { DEPTH } from './ShopViews';

/**
 * Small particle effects that make the world feel busy: coins at a till when someone pays,
 * steam from coffee machines, smoke from kitchens, dust when you build.
 * Everything is skipped on the Low graphics setting and for things that are off screen.
 */
export class Effects {
  private coins: Phaser.GameObjects.Particles.ParticleEmitter;
  private puffs: Phaser.GameObjects.Particles.ParticleEmitter;
  private dust: Phaser.GameObjects.Particles.ParticleEmitter;
  private clock = 0;
  private offs: (() => void)[];

  constructor(private scene: Phaser.Scene) {
    this.coins = scene.add.particles(0, 0, ATLAS, {
      frame: ['fx:coin', 'fx:spark'], lifespan: 650, speed: { min: 40, max: 110 }, angle: { min: 220, max: 320 }, gravityY: 260,
      scale: 2, alpha: { start: 1, end: 0 }, emitting: false,
    }).setDepth(DEPTH.bubbles - 1);
    this.puffs = scene.add.particles(0, 0, ATLAS, {
      frame: 'fx:puff', lifespan: 1300, speedY: { min: -34, max: -18 }, speedX: { min: -8, max: 8 },
      scale: { start: 1.5, end: 3.5 }, alpha: { start: 0.55, end: 0 }, emitting: false,
    }).setDepth(DEPTH.npcs + 2);
    this.dust = scene.add.particles(0, 0, ATLAS, {
      frame: 'fx:dust', lifespan: 480, speed: { min: 20, max: 70 }, angle: { min: 180, max: 360 },
      scale: { start: 2, end: 1 }, alpha: { start: 0.9, end: 0 }, emitting: false,
    }).setDepth(DEPTH.npcs + 2);

    this.offs = [
      bus.on('sale', ({ x, y }) => this.burst(this.coins, (x + 0.5) * TILE, (y + 0.4) * TILE, 6)),
      bus.on('fx', ({ kind, x, y }) => {
        if (kind === 'dust') this.burst(this.dust, (x + 0.5) * TILE, (y + 0.8) * TILE, 8);
        else if (kind === 'coins') this.burst(this.coins, (x + 0.5) * TILE, (y + 0.4) * TILE, 6);
        else this.burst(this.puffs, (x + 0.5) * TILE, (y + 0.2) * TILE, 2, kind === 'smoke' ? 0x8f8f8f : 0xffffff);
      }),
    ];
  }

  private burst(emitter: Phaser.GameObjects.Particles.ParticleEmitter, x: number, y: number, count: number, tint?: number): void {
    const q = quality();
    if (q.particles <= 0) return;
    const view = this.scene.cameras.main.worldView;
    if (x < view.x - 60 || x > view.right + 60 || y < view.y - 60 || y > view.bottom + 60) return;
    if (tint !== undefined) emitter.setParticleTint(tint);
    emitter.emitParticleAt(x, y, Math.max(1, Math.round(count * q.particles)));
  }

  /** Steam and smoke from equipment that is actually working. */
  update(realDt: number): void {
    const s = session.state;
    if (s.time.speed === 0 || quality().particles <= 0) return;
    this.clock += realDt;
    if (this.clock < 0.5) return;
    this.clock = 0;
    for (const shop of s.shops) {
      const cooking = (rt.kitchens.get(shop.id)?.length ?? 0) > 0;
      for (const o of shop.objects) {
        const d = defOf(o);
        if (o.broken) continue;
        const { w } = footprint(o.def, o.rot);
        const x = (o.x + w / 2) * TILE;
        const y = (o.y + 0.2) * TILE;
        if (d.kind === 'cookstation' && cooking) {
          const smoky = d.station === 'grill' || d.station === 'fryer';
          this.burst(this.puffs, x, y, 1, smoky ? 0x9a9a9a : 0xffffff);
        } else if (d.kind === 'producer' && (o.progress ?? 0) > 0) {
          this.burst(this.puffs, x, y, 1, d.station === 'bake' || d.station === 'oven' || d.station === 'roast' ? 0xb0a090 : 0xffffff);
        } else if (d.service === 'svc_carwash' && (rt.stations.get(regKey(shop.id, o.id))?.length ?? 0) > 0) {
          this.burst(this.puffs, x, y + TILE, 2, 0xbfe3f0);
        }
      }
    }
  }

  destroy(): void {
    this.offs.forEach((off) => off());
  }
}
