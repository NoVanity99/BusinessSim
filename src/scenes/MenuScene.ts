import Phaser from 'phaser';
import { ATLAS, SCALE } from '../art/atlas';
import { charFrame } from '../art/actorArt';
import { bakeCity } from '../art/cityArt';
import { ADULT_LOOKS } from '../art/looks';
import { TILE } from '../core/constants';
import { T } from '../systems/city/generate';
import { createNewGame, session } from '../core/state';
import { generateCity } from '../systems/city/generate';
import { music } from '../systems/audio/audio';
import { loadGameDetailed } from '../systems/save/saves';
import { startUpdateChecks } from '../systems/update/updater';
import { clear, h, uiRoot } from '../ui/dom';
import { MainMenu } from '../ui/screens/MainMenu';
import { NewGame } from '../ui/screens/NewGame';
import { SaveList } from '../ui/screens/SaveList';
import { SettingsView } from '../ui/screens/Settings';

/** Hosts the HTML menu screens over a slowly drifting view of the city. */
export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    music.stop();
    this.backdrop();
    this.showMain();
    // The menu is on screen; now it is safe to look for updates in the background.
    startUpdateChecks();
    this.events.once('shutdown', () => clear(uiRoot()));
  }

  /** A living backdrop: the city drifting past, with people out for a walk and birds overhead. */
  private backdrop(): void {
    const city = generateCity();
    for (const chunk of bakeCity(this, city)) this.add.image(chunk.tx * TILE, chunk.ty * TILE, chunk.key).setOrigin(0);
    const cam = this.cameras.main;
    const W = city.w * TILE;
    const H = city.h * TILE;
    cam.setBounds(0, 0, W, H).setZoom(1);
    cam.centerOn(W * 0.3, H * 0.35);
    // Drift around a slow loop so the view never repeats quickly.
    const stops = [[0.7, 0.35], [0.7, 0.7], [0.3, 0.7], [0.3, 0.35]];
    const drift = (i: number): void => {
      const [fx, fy] = stops[i % stops.length];
      cam.pan(W * fx, H * fy, 42000, 'Sine.easeInOut', true, (_c, t) => t === 1 && drift(i + 1));
    };
    drift(0);

    // Strollers on the pavements: each walks a stretch of pavement back and forth.
    const rng = new Phaser.Math.RandomDataGenerator(['menu']);
    const rows: { y: number; x0: number; x1: number }[] = [];
    for (let y = 0; y < city.h; y++) {
      let run = 0;
      for (let x = 0; x <= city.w; x++) {
        const walk = x < city.w && city.tiles[y * city.w + x] === T.Sidewalk;
        if (walk) run++;
        else {
          if (run >= 10) rows.push({ y, x0: x - run, x1: x - 1 });
          run = 0;
        }
      }
    }
    for (let n = 0; n < 70 && rows.length; n++) {
      const row = rng.pick(rows);
      const look = rng.pick(ADULT_LOOKS);
      const from = rng.between(row.x0, row.x1);
      const to = rng.between(row.x0, row.x1);
      if (Math.abs(to - from) < 4) continue;
      const img = this.add.image((from + 0.5) * TILE, (row.y + 0.5) * TILE, ATLAS, charFrame(look, to > from ? 'right' : 'left', 0)).setScale(SCALE).setOrigin(0.5, 0.8);
      const state = { step: 0 };
      this.tweens.add({ targets: img, x: (to + 0.5) * TILE, duration: Math.abs(to - from) * 420, yoyo: true, repeat: -1, hold: rng.between(400, 2500), repeatDelay: rng.between(400, 2500), delay: rng.between(0, 3000) });
      this.time.addEvent({
        delay: 170,
        loop: true,
        callback: () => {
          const moving = Math.abs(img.x - (img.getData('px') ?? img.x)) > 0.01;
          const dir = img.x >= (img.getData('px') ?? img.x) ? 'right' : 'left';
          if (moving) img.setFrame(charFrame(look, dir, ++state.step % 3));
          img.setData('px', img.x);
        },
      });
    }
    // A gentle wash of evening colour over everything.
    this.add.rectangle(0, 0, W, H, 0x1a2140, 0.18).setOrigin(0).setDepth(5);
  }

  private show(el: HTMLElement): void {
    uiRoot().replaceChildren(el);
  }

  private framed(title: string, content: HTMLElement): HTMLElement {
    return h('div.screen', h('div.panel.window', { style: { position: 'relative' } }, h('h2', title), content));
  }

  private async loadSlot(slot: string): Promise<void> {
    const result = await loadGameDetailed(slot);
    if (result.ok) this.scene.start('City');
    else alert(result.reason);
  }

  private showMain(): void {
    this.show(
      MainMenu({
        onNewGame: () => this.showNewGame(),
        onContinue: (slot) => void this.loadSlot(slot),
        onLoad: () => this.show(this.framed('Load Game', SaveList('load', (slot) => void this.loadSlot(slot), () => this.showMain()))),
        onSettings: () => this.show(this.framed('Settings', SettingsView(() => this.showMain()))),
      }),
    );
  }

  private showNewGame(): void {
    this.show(
      NewGame({
        onBack: () => this.showMain(),
        onStart: (opts) => {
          session.state = createNewGame(opts);
          session.city = generateCity();
          this.scene.start('City');
        },
      }),
    );
  }
}
