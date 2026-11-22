import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MainMenuScene } from './scenes/MainMenuScene';
import { COLORS } from './ui/theme';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: COLORS.bg,
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  render: { antialias: true, roundPixels: true },
  disableContextMenu: true,
  scene: [BootScene, MainMenuScene],
});

// Handy for debugging and automated smoke tests.
(window as unknown as { game: Phaser.Game }).game = game;
