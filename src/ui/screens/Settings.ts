import { isElectron } from '../../core/platform';
import { ACTIONS, applyDisplay, DEFAULT_KEYS, keyLabel, RESOLUTIONS, saveSettings, settings, type Action } from '../../core/settings';
import { sfx } from '../../systems/audio/audio';
import { h, setChildren } from '../dom';

/** Settings form, used from both the main menu and the pause menu. */
export function SettingsView(onBack: () => void): HTMLElement {
  const body = h('div.settings');
  let capturing: Action | null = null;

  const slider = (label: string, key: 'masterVolume' | 'sfxVolume' | 'musicVolume'): HTMLElement => {
    const value = h('span.dim', `${Math.round(settings[key] * 100)}%`);
    return h(
      'div.kv',
      h('span.k', label),
      h('span.row', h('input', {
        type: 'range', min: 0, max: 100, value: Math.round(settings[key] * 100),
        oninput: (e: Event) => {
          settings[key] = +(e.target as HTMLInputElement).value / 100;
          value.textContent = `${Math.round(settings[key] * 100)}%`;
          saveSettings();
        },
        onchange: () => sfx('register'),
      }), value),
    );
  };

  const onKey = (e: KeyboardEvent): void => {
    if (!capturing) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code !== 'Escape' || capturing === 'menu') {
      // A key can only do one thing: whoever had it before gets the key being replaced.
      const previous = settings.keys[capturing];
      for (const a of Object.keys(settings.keys) as Action[]) if (settings.keys[a] === e.code) settings.keys[a] = previous;
      settings.keys[capturing] = e.code;
      saveSettings();
    }
    capturing = null;
    render();
  };
  window.addEventListener('keydown', onKey, true);

  const render = (): void => {
    setChildren(
      body,
      h('div.section', 'Audio'),
      slider('Master volume', 'masterVolume'),
      slider('Sound effects', 'sfxVolume'),
      slider('Music', 'musicVolume'),
      h('div.section', 'Display'),
      h('label.check', h('input', { type: 'checkbox', checked: settings.fullscreen, onchange: (e: Event) => { settings.fullscreen = (e.target as HTMLInputElement).checked; saveSettings(); void applyDisplay(); } }), 'Fullscreen (F11)'),
      h(
        'div.kv',
        { tip: isElectron ? 'Window size when not in fullscreen.' : 'Window size can only be changed in the desktop version.' },
        h('span.k', 'Resolution'),
        h(
          'select',
          { disabled: !isElectron, onchange: (e: Event) => { settings.resolution = (e.target as HTMLSelectElement).value; saveSettings(); void applyDisplay(); } },
          ...RESOLUTIONS.map((r) => h('option', { value: r, selected: settings.resolution === r }, r === 'window' ? 'Keep current window' : r.replace('x', ' × '))),
        ),
      ),
      h('div.section', 'Game'),
      h('label.check', h('input', { type: 'checkbox', checked: settings.autosave, onchange: (e: Event) => { settings.autosave = (e.target as HTMLInputElement).checked; saveSettings(); } }), 'Autosave every morning at 06:00'),
      h('div.section', 'Keys'),
      h(
        'div.keys',
        ...(Object.keys(ACTIONS) as Action[]).map((a) =>
          h('div.kv', h('span.k', ACTIONS[a]), h('button', { class: capturing === a ? 'active' : '', onclick: () => { capturing = a; render(); } }, capturing === a ? 'Press a key…' : keyLabel(settings.keys[a]))),
        ),
      ),
      h('div.note', 'Arrow keys always move the camera. Click a key to rebind it.'),
    );
  };
  render();

  const close = (): void => {
    window.removeEventListener('keydown', onKey, true);
    onBack();
  };
  return h(
    'div.window-body',
    body,
    h('div.row', { style: { marginTop: '12px', justifyContent: 'space-between' } }, h('button', { onclick: () => { settings.keys = { ...DEFAULT_KEYS }; saveSettings(); render(); } }, 'Reset keys'), h('button.primary', { onclick: close }, 'Done')),
  );
}
