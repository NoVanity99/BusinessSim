import { APP_VERSION, isElectron, platform } from '../../core/platform';
import { h } from '../dom';

export interface MainMenuActions {
  onNewGame(): void;
}

export function MainMenu(actions: MainMenuActions): HTMLElement {
  const status = h('div.status');
  const soon = (what: string) => () => (status.textContent = `${what} arrive in milestone 6.`);
  return h(
    'div.screen',
    h('h1', 'BusinessSim'),
    h('div.tagline', 'From one tiny shop to a city-wide empire'),
    h(
      'div.menu',
      h('button.primary', { onclick: actions.onNewGame }, 'New Game'),
      h('button', { onclick: soon('Save slots') }, 'Load Game'),
      h('button', { onclick: soon('Settings') }, 'Settings'),
      isElectron && h('button', { onclick: () => void platform?.quit() }, 'Quit'),
    ),
    status,
    h('div.footer', `v${APP_VERSION} · ${isElectron ? 'desktop' : 'browser'} · F11 fullscreen`),
  );
}
