import Phaser from 'phaser';
import { installInput } from '../core/input';
import { loadSettings } from '../core/settings';
import { installAudio } from '../systems/audio/audio';
import { initUpdater } from '../systems/update/updater';
import { installTooltips } from '../ui/tooltip';

/** One-time setup before the menu appears. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    installTooltips();
    installInput();
    installAudio();
    // Settings load from disk; the menu waits for them so volume and keys are right from the start.
    void loadSettings()
      .catch((err) => console.warn('Could not load settings', err))
      // The updater only connects here; it does not check until the menu is showing.
      .then(() => initUpdater())
      .then(() => this.scene.start('Menu'));
  }
}
