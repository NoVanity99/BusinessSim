import Phaser from 'phaser';
import { APP_VERSION, isElectron, platform } from '../core/platform';
import { readJson, writeJson } from '../systems/save/storage';
import { Button } from '../ui/Button';
import { COLORS, textStyle } from '../ui/theme';

export class MainMenuScene extends Phaser.Scene {
  private status!: Phaser.GameObjects.Text;

  constructor() {
    super('MainMenu');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.build();
    // Rebuild on resize so the menu stays centred at any resolution.
    this.scale.on('resize', this.rebuild, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.rebuild, this));
    void this.checkStorage();
  }

  private rebuild(): void {
    this.children.removeAll(true);
    this.build();
    void this.checkStorage();
  }

  private build(): void {
    const { width, height } = this.scale;
    const cx = width / 2;

    this.add.text(cx, height * 0.22, 'BusinessSim', textStyle(64, COLORS.accent, { fontStyle: 'bold' })).setOrigin(0.5);
    this.add.text(cx, height * 0.22 + 56, 'From one tiny shop to a city-wide empire', textStyle(18, COLORS.textDim)).setOrigin(0.5);

    let y = height * 0.48;
    const step = 60;
    new Button(this, cx, y, 'New Game', { onClick: () => this.note('The city arrives in milestone 2.') });
    new Button(this, cx, (y += step), 'Load Game', { onClick: () => this.note('Save slots arrive in milestone 6.') });
    new Button(this, cx, (y += step), 'Settings', { onClick: () => this.note('Settings arrive in milestone 6.') });
    if (isElectron) new Button(this, cx, (y += step), 'Quit', { onClick: () => void platform?.quit() });

    this.status = this.add.text(cx, y + step, '', textStyle(14, COLORS.textDim)).setOrigin(0.5);
    this.add
      .text(width - 12, height - 10, `v${APP_VERSION} · ${isElectron ? 'desktop' : 'browser'} · F11 fullscreen`, textStyle(12, COLORS.textDim))
      .setOrigin(1, 1);
  }

  private note(msg: string): void {
    this.status.setText(msg);
  }

  /** Milestone 1 smoke test: prove the save backend round-trips. */
  private async checkStorage(): Promise<void> {
    try {
      const prev = await readJson<{ launches: number }>('meta');
      const launches = (prev?.launches ?? 0) + 1;
      await writeJson('meta', { launches });
      const where = platform ? await platform.savesPath() : 'browser localStorage';
      this.note(`Storage OK · launch #${launches} · ${where}`);
    } catch (err) {
      this.note(`Storage error: ${(err as Error).message}`);
    }
  }
}
