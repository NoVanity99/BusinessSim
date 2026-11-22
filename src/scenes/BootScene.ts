import Phaser from 'phaser';

/** Generates procedural textures and loads settings before the menu appears. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    this.scene.start('MainMenu');
  }
}
