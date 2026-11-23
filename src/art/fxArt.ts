import Phaser from 'phaser';
import { addFrame, U } from './atlas';

/**
 * Street props, particles and the light texture.
 * Frame names: `prop:<name>`, `signal:<state>`, `tree:<kind>:<frame>`, `fx:<name>`.
 */
export const LIGHT_TEX = 'light';

export function registerFxFrames(scene: Phaser.Scene): void {
  // Lamp post: two tiles tall, from the urban pack.
  addFrame('prop:lamp', U, 2 * U, (p) => p.tile('urban', 2, 6).tile('urban', 2, 7, 0, U));
  addFrame('prop:lamp_lit', U, 2 * U, (p) => p.tile('urban', 2, 6).tile('urban', 2, 7, 0, U).r(1, 5, 5, 2, '#fff4c9'));
  addFrame('prop:hydrant', U, U, (p) => p.tile('urban', 8, 10));
  addFrame('prop:mailbox', U, U, (p) => p.tile('urban', 8, 11));
  addFrame('prop:bench', U, U, (p) => p.tile('urban', 7, 9));
  addFrame('prop:bin', U, U, (p) => p.tile('urban', 10, 10));

  // Traffic signal: the pack's unlit signal with one lamp painted on.
  const signal = (name: string, lamp: [number, string] | null): void =>
    addFrame(`signal:${name}`, U, U, (p) => {
      p.tile('urban', 5, 15);
      if (lamp) p.r(4, lamp[0], 3, 3, lamp[1]);
    });
  signal('off', null);
  signal('red', [5, '#ff5a52']);
  signal('amber', [8, '#ffc90e']);
  signal('green', [11, '#5ee08a']);

  // Trees as separate sprites (no grass behind them) with a second frame leaning in the wind.
  const trees: [number, number][] = [[22, 9], [22, 10], [21, 10]];
  trees.forEach(([col, row], k) => {
    addFrame(`tree:${k}:0`, U, U, (p) => p.tile('urban', col, row));
    // The crown leans one pixel; the trunk stays put.
    addFrame(`tree:${k}:1`, U, U, (p) => p.tile('urban', col, row).shift(0, 0, U, 9, 1));
  });

  addFrame('fx:rain', 1, 5, (p) => p.r(0, 0, 1, 5, '#bfe3f0'));
  addFrame('fx:snow', 2, 2, (p) => p.r(0, 0, 2, 2, '#ffffff'));
  addFrame('fx:coin', 3, 3, (p) => p.r(0, 0, 3, 3, '#c69900').r(1, 0, 1, 3, '#ffc90e').r(0, 1, 3, 1, '#ffc90e'));
  addFrame('fx:puff', 4, 4, (p) => p.r(1, 0, 2, 4, '#ffffff').r(0, 1, 4, 2, '#ffffff'));
  addFrame('fx:dust', 3, 3, (p) => p.r(0, 0, 3, 3, '#c6bc9f').r(1, 1, 1, 1, '#e6dabf'));
  addFrame('fx:spark', 3, 3, (p) => p.r(1, 0, 1, 3, '#fff4c9').r(0, 1, 3, 1, '#fff4c9'));

  // A soft round light, kept as its own smooth texture: it is drawn scaled and must not be pixelated.
  if (!scene.textures.exists(LIGHT_TEX)) {
    const size = 128;
    const tex = scene.textures.createCanvas(LIGHT_TEX, size, size)!;
    const g = tex.getContext();
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.75)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    tex.refresh();
    tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
  }
}
