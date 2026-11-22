import { bus } from '../core/events';
import { h, uiRoot } from './dom';

/** Stacked notifications in the bottom-left corner. Returns a cleanup function. */
export function mountToasts(): () => void {
  const box = h('div.toasts');
  uiRoot().append(box);
  const off = bus.on('toast', ({ text, kind }) => {
    const el = h(`div.toast.${kind ?? 'info'}`, text);
    box.append(el);
    while (box.children.length > 5) box.firstElementChild?.remove();
    setTimeout(() => el.classList.add('out'), 4200);
    setTimeout(() => el.remove(), 4700);
  });
  return () => {
    off();
    box.remove();
  };
}
