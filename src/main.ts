import Phaser from 'phaser';
import './ui/styles.css';
import { BootScene } from './scenes/BootScene';
import { CityScene } from './scenes/CityScene';
import { MenuScene } from './scenes/MenuScene';
import { session } from './core/state';
import { rt } from './systems/ai/runtime';
import { debugApi } from './core/debug';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#10141c',
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  // Pixel art: nearest-neighbour sampling and whole-pixel positions keep it crisp.
  render: { pixelArt: true, antialias: false, roundPixels: true },
  disableContextMenu: true,
  scene: [BootScene, MenuScene, CityScene],
});

// Handy for debugging and automated smoke tests.
Object.assign(window, { game, session, rt, __dbg: debugApi });
