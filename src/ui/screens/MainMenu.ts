import { money } from '../../core/format';
import { APP_VERSION, isElectron, platform } from '../../core/platform';
import { latestSave } from '../../systems/save/saves';
import { h } from '../dom';
import { UpdateNotice } from '../hud/UpdateNotice';

export interface MainMenuActions {
  onNewGame(): void;
  onContinue(slot: string): void;
  onLoad(): void;
  onSettings(): void;
}

export function MainMenu(actions: MainMenuActions): HTMLElement {
  const continueBtn = h('button.primary', { style: { display: 'none' } }, 'Continue');
  void latestSave().then((m) => {
    if (!m) return;
    continueBtn.style.display = '';
    continueBtn.textContent = `Continue · ${m.company}, day ${m.day}`;
    continueBtn.dataset.tip = `${money(m.money)} cash, ${m.shops} shop${m.shops === 1 ? '' : 's'}`;
    continueBtn.onclick = () => actions.onContinue(m.slot);
  });
  return h(
    'div.screen',
    UpdateNotice().el,
    h('h1', 'BusinessSim'),
    h('div.tagline', 'From one tiny shop to a city-wide empire'),
    h(
      'div.menu',
      continueBtn,
      h('button', { onclick: actions.onNewGame }, 'New Game'),
      h('button', { onclick: actions.onLoad }, 'Load Game'),
      h('button', { onclick: actions.onSettings }, 'Settings'),
      isElectron && h('button', { onclick: () => void platform?.quit() }, 'Quit'),
    ),
    h('div.footer', `v${APP_VERSION} · ${isElectron ? 'desktop' : 'browser'} · F11 fullscreen`),
  );
}
