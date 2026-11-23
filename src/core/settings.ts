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
  stock: 'Stock screen',
  help: 'Help and controls',
  notifications: 'Notifications',
  minimap: 'Show or hide the map',
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
  stock: 'KeyK',
  help: 'F1',
  notifications: 'KeyN',
  minimap: 'KeyM',
};

export type Quality = 'low' | 'medium' | 'high';

/** What each graphics level turns on. Renderers read this instead of checking the level by name. */
export const QUALITY: Record<Quality, { label: string; lights: boolean; lightRes: number; shadows: boolean; particles: number; weather: number; props: boolean }> = {
  low: { label: 'Low', lights: false, lightRes: 0, shadows: false, particles: 0, weather: 0.35, props: false },
  medium: { label: 'Medium', lights: true, lightRes: 0.5, shadows: true, particles: 0.5, weather: 0.7, props: true },
  high: { label: 'High', lights: true, lightRes: 1, shadows: true, particles: 1, weather: 1, props: true },
};
export const quality = (): (typeof QUALITY)[Quality] => QUALITY[settings.quality] ?? QUALITY.high;

export const RESOLUTIONS = ['window', '1280x720', '1366x768', '1600x900', '1920x1080', '2560x1080', '2560x1440', '3440x1440'] as const;

/** Interface sizes on offer. 0 picks one from the height of the window. */
export const UI_SCALES = [0, 0.85, 1, 1.15, 1.3, 1.5, 1.75] as const;

export interface Settings {
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  fullscreen: boolean;
  resolution: string;
  autosave: boolean;
  /** Download new versions in the background as soon as they are found. */
  autoDownloadUpdates: boolean;
  /** Graphics detail: lights, shadows, particles and weather density. */
  quality: Quality;
  /** Interface size multiplier; 0 = choose from the window height. */
  uiScale: number;
  /** Swap red/green signalling for blue/orange. */
  colorblind: boolean;
  /** The getting-started tutorial has been finished or dismissed. */
  tutorialDone: boolean;
  keys: Record<Action, string>;
}

export const settings: Settings = {
  masterVolume: 0.8,
  sfxVolume: 0.8,
  musicVolume: 0.35,
  fullscreen: false,
  resolution: 'window',
  autosave: true,
  autoDownloadUpdates: true,
  quality: 'high',
  uiScale: 0,
  colorblind: false,
  tutorialDone: false,
  keys: { ...DEFAULT_KEYS },
};

/** The interface scale in effect: the chosen one, or one that suits the window (1080p and up get a larger interface). */
export function effectiveUiScale(): number {
  if (settings.uiScale > 0) return settings.uiScale;
  const h = window.innerHeight;
  return h >= 1350 ? 1.5 : h >= 1000 ? 1.25 : h >= 860 ? 1.1 : 1;
}

/** Colours used for good/bad signalling in the world, following the colour-blind setting. */
export const signal = (): { good: number; bad: number; mine: number; free: number } =>
  settings.colorblind ? { good: 0x3987e5, bad: 0xd95926, mine: 0x3987e5, free: 0xf2d24b } : { good: 0x4fc3a1, bad: 0xe5605a, mine: 0x4fc3a1, free: 0xf2d24b };

/** Push the interface settings into CSS. */
export function applyInterface(): void {
  const root = document.documentElement;
  root.style.setProperty('--ui-scale', String(effectiveUiScale()));
  root.toggleAttribute('data-cb', settings.colorblind);
}

const listeners = new Set<() => void>();
export const onSettingsChanged = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export async function loadSettings(): Promise<void> {
  const saved = await readJson<Partial<Settings>>('settings');
  if (saved) Object.assign(settings, saved, { keys: { ...DEFAULT_KEYS, ...(saved.keys ?? {}) } });
  await applyDisplay();
  applyInterface();
  window.addEventListener('resize', applyInterface);
}

export function saveSettings(): void {
  applyInterface();
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
