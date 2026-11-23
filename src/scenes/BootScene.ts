import Phaser from 'phaser';
import { registerActorFrames } from '../art/actorArt';
import { atlasUsage, beginAtlas, finishAtlas, preloadAtlasSources } from '../art/atlas';
import { registerFurnitureFrames } from '../art/furnitureArt';
import { registerWorldFrames } from '../art/worldArt';
import { installInput } from '../core/input';
import { loadSettings } from '../core/settings';
import { installAudio } from '../systems/audio/audio';
import { initUpdater } from '../systems/update/updater';
import { installTooltips } from '../ui/tooltip';

/** One-time setup before the menu appears: art, input, sound, settings. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    preloadAtlasSources(this);
  }

  create(): void {
    // All world art goes into one texture so the renderer can draw it in a few batches.
    beginAtlas(this);
    registerWorldFrames();
    registerFurnitureFrames();
    registerActorFrames();
    finishAtlas(this);
    const usage = atlasUsage();
    console.info(`Atlas: ${usage.frames} frames, ${Math.round(usage.filled * 100)}% of the sheet used`);

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
