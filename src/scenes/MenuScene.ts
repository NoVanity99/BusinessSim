import Phaser from 'phaser';
import { createNewGame, session } from '../core/state';
import { generateCity } from '../systems/city/generate';
import { clear, uiRoot } from '../ui/dom';
import { MainMenu } from '../ui/screens/MainMenu';
import { NewGame } from '../ui/screens/NewGame';

/** Hosts the HTML menu screens. The canvas stays blank behind them. */
export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    this.showMain();
    this.events.once('shutdown', () => clear(uiRoot()));
  }

  private show(el: HTMLElement): void {
    uiRoot().replaceChildren(el);
  }

  private showMain(): void {
    this.show(MainMenu({ onNewGame: () => this.showNewGame() }));
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
