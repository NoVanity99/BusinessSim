import { readJson, writeJson } from '../systems/save/storage';
import { platform } from './platform';

export const ACTIONS = {
  panUp: 'Move camera up',
  panDown: 'Move camera down',
  panLeft: 'Move camera left',
  panRight: 'Move camera right',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  pause: 'Pause / resume',
  speed1: 'Normal speed',
  speed2: 'Double speed',
  speed3: 'Quadruple speed',
  rotate: 'Rotate furniture',
  menu: 'Cancel / pause menu',
  quickSave: 'Quick save',
  businesses: 'Businesses panel',
  finances: 'Finances panel',
  staff: 'Staff panel',
} as const;

export type Action = keyof typeof ACTIONS;

/** Values are KeyboardEvent.code strings, so bindings follow key position on any layout. */
export const DEFAULT_KEYS: Record<Action, string> = {
  panUp: 'KeyW',
  panDown: 'KeyS',
  panLeft: 'KeyA',
  panRight: 'KeyD',
  zoomIn: 'Equal',
  zoomOut: 'Minus',
  pause: 'Space',
  speed1: 'Digit1',
  speed2: 'Digit2',
  speed3: 'Digit3',
  rotate: 'KeyR',
  menu: 'Escape',
  quickSave: 'F5',
  businesses: 'KeyB',
  finances: 'KeyF',
  staff: 'KeyT',
};

export const RESOLUTIONS = ['window', '1280x720', '1366x768', '1600x900', '1920x1080', '2560x1440'] as const;

export interface Settings {
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  fullscreen: boolean;
  resolution: string;
  autosave: boolean;
  keys: Record<Action, string>;
}

export const settings: Settings = {
  masterVolume: 0.8,
  sfxVolume: 0.8,
  musicVolume: 0.35,
  fullscreen: false,
  resolution: 'window',
  autosave: true,
  keys: { ...DEFAULT_KEYS },
};

const listeners = new Set<() => void>();
export const onSettingsChanged = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export async function loadSettings(): Promise<void> {
  const saved = await readJson<Partial<Settings>>('settings');
  if (saved) Object.assign(settings, saved, { keys: { ...DEFAULT_KEYS, ...(saved.keys ?? {}) } });
  await applyDisplay();
}

export function saveSettings(): void {
  listeners.forEach((fn) => fn());
  void writeJson('settings', settings);
}

/** Apply fullscreen and window size. In the browser only fullscreen is available. */
export async function applyDisplay(): Promise<void> {
  if (platform) {
    if (!settings.fullscreen && settings.resolution !== 'window') {
      const [w, h] = settings.resolution.split('x').map(Number);
      await platform.window.setSize(w, h);
    }
    await platform.window.setFullscreen(settings.fullscreen);
  } else if (settings.fullscreen && !document.fullscreenElement) {
    // Browsers only allow this from a user gesture; ignore the refusal on startup.
    document.documentElement.requestFullscreen?.().catch(() => undefined);
  } else if (!settings.fullscreen && document.fullscreenElement) {
    void document.exitFullscreen();
  }
}

/** Human-readable name for a KeyboardEvent.code. */
export function keyLabel(code: string): string {
  return code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace(/^Numpad/, 'Num ')
    .replace('Equal', '=')
    .replace('Minus', '-')
    .replace('Escape', 'Esc')
    .replace(/^Arrow/, '');
}
