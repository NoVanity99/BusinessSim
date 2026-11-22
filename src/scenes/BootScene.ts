import Phaser from 'phaser';
import { installTooltips } from '../ui/tooltip';

/** One-time setup before the menu appears. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    installTooltips();
    this.scene.start('Menu');
  }
}
