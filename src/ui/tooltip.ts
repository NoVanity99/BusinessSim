import { h } from './dom';

/** One global tooltip driven by `data-tip` attributes, so any element can have one. */
let tipEl: HTMLElement | null = null;

export function installTooltips(): void {
  if (tipEl) return;
  tipEl = h('div', { id: 'tooltip' });
  document.body.append(tipEl);
  document.addEventListener('mousemove', (e) => {
    const target = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
    if (!target?.dataset.tip) return hideTip();
    showTip(target.dataset.tip, e.clientX, e.clientY);
  });
  document.addEventListener('mousedown', hideTip);
}

export function showTip(text: string, x: number, y: number): void {
  if (!tipEl) return;
  if (tipEl.textContent !== text) tipEl.textContent = text;
  tipEl.style.display = 'block';
  const r = tipEl.getBoundingClientRect();
  const left = Math.min(x + 14, window.innerWidth - r.width - 8);
  const top = y + 18 + r.height > window.innerHeight ? y - r.height - 10 : y + 18;
  tipEl.style.left = `${Math.max(8, left)}px`;
  tipEl.style.top = `${Math.max(8, top)}px`;
}

export function hideTip(): void {
  if (tipEl) tipEl.style.display = 'none';
}
