import { settings, type Action } from './settings';

/**
 * Keyboard input routed through the rebindable settings. Typing in a text field never
 * triggers game actions. Arrow keys always pan, in addition to the bound keys.
 */
const down = new Set<string>();
const handlers = new Map<Action, Set<() => void>>();
let installed = false;

const typing = (e: KeyboardEvent): boolean => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};

export function installInput(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('keydown', (e) => {
    if (typing(e)) return;
    if (!e.repeat) {
      for (const [action, code] of Object.entries(settings.keys) as [Action, string][]) {
        if (code === e.code) handlers.get(action)?.forEach((fn) => fn());
      }
    }
    down.add(e.code);
    // Stop the page from scrolling or the browser from reloading on game keys.
    if (['Space', 'F5', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => down.delete(e.code));
  window.addEventListener('blur', () => down.clear());
}

export function onAction(action: Action, fn: () => void): () => void {
  let set = handlers.get(action);
  if (!set) handlers.set(action, (set = new Set()));
  set.add(fn);
  return () => set.delete(fn);
}

export const isDown = (action: Action): boolean => down.has(settings.keys[action]);
export const isCodeDown = (code: string): boolean => down.has(code);
