import Phaser from 'phaser';
import './ui/styles.css';
import { BootScene } from './scenes/BootScene';
import { CityScene } from './scenes/CityScene';
import { MenuScene } from './scenes/MenuScene';
import { session } from './core/state';
import { rt } from './systems/ai/runtime';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#10141c',
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  render: { antialias: true, roundPixels: false },
  disableContextMenu: true,
  scene: [BootScene, MenuScene, CityScene],
});

// Handy for debugging and automated smoke tests.
Object.assign(window, { game, session, rt });
