import { isElectron, platform } from '../../core/platform';
import { h, setChildren } from '../dom';
import { SaveList } from './SaveList';
import { SettingsView } from './Settings';

export interface PauseActions {
  onResume(): void;
  onSave(slot: string): void;
  onLoad(slot: string): void;
  onQuitToMenu(): void;
}

/** Full-screen overlay shown while the game is paused from the menu key. */
export function PauseMenu(actions: PauseActions): HTMLElement {
  const box = h('div.panel.window', { style: { position: 'relative' } });
  const main = (): void => {
    box.className = 'panel window pause-menu';
    setChildren(
      box,
      h('h2', 'Paused'),
      h(
        'div.menu',
        h('button.primary', { onclick: actions.onResume }, 'Resume'),
        h('button', { onclick: () => sub('Save Game', SaveList('save', (slot) => { actions.onSave(slot); main(); }, main)) }, 'Save Game'),
        h('button', { onclick: () => sub('Load Game', SaveList('load', actions.onLoad, main)) }, 'Load Game'),
        h('button', { onclick: () => sub('Settings', SettingsView(main)) }, 'Settings'),
        h('button', { onclick: () => { if (confirm('Return to the main menu? Unsaved progress will be lost.')) actions.onQuitToMenu(); } }, 'Quit to Main Menu'),
        isElectron && h('button', { onclick: () => { if (confirm('Quit the game? Unsaved progress will be lost.')) void platform?.quit(); } }, 'Quit to Desktop'),
      ),
    );
  };
  const sub = (title: string, content: HTMLElement): void => {
    box.className = 'panel window';
    setChildren(box, h('h2', title), content);
  };
  main();
  return h('div.overlay', box);
}
