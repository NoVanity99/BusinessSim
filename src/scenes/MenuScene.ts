import Phaser from 'phaser';
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

/** Hosts the HTML menu screens. The canvas stays blank behind them. */
export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    music.stop();
    this.showMain();
    // The menu is on screen; now it is safe to look for updates in the background.
    startUpdateChecks();
    this.events.once('shutdown', () => clear(uiRoot()));
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
