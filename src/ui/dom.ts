type Child = Node | string | number | boolean | null | undefined;
type Props = Record<string, unknown>;

/**
 * Tiny hyperscript helper: h('button.primary', { onclick, tip: 'Tooltip' }, 'Label').
 * `tip` sets a tooltip, `class` adds classes, `style` accepts an object, on* attach listeners.
 */
export function h<K extends keyof HTMLElementTagNameMap>(spec: K | `${K}.${string}`, props?: Props | Child, ...children: Child[]): HTMLElementTagNameMap[K] {
  const [tag, ...classes] = (spec as string).split('.');
  const el = document.createElement(tag) as HTMLElementTagNameMap[K];
  if (classes.length) el.className = classes.join(' ');
  let kids = children;
  if (props !== null && typeof props === 'object' && !(props instanceof Node)) {
    for (const [k, v] of Object.entries(props as Props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'tip') el.dataset.tip = String(v);
      else if (k === 'class') el.classList.add(...String(v).split(' ').filter(Boolean));
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (k in el) (el as unknown as Props)[k] = v;
      else el.setAttribute(k, String(v));
    }
  } else {
    kids = [props as Child, ...children];
  }
  append(el, kids);
  return el;
}

export function append(el: HTMLElement, kids: Child[]): void {
  for (const c of kids) {
    if (c === null || c === undefined || typeof c === "boolean") continue;
    el.append(c instanceof Node ? c : String(c));
  }
}

export function clear(el: HTMLElement): void {
  el.replaceChildren();
}

/** The overlay that holds all HTML UI, layered above the game canvas. */
export function uiRoot(): HTMLElement {
  let root = document.getElementById('ui');
  if (!root) {
    root = h('div', { id: 'ui' });
    document.body.append(root);
  }
  return root;
}

/** Day/night tint layer between the canvas and the UI. */
export function nightLayer(): HTMLElement {
  let el = document.getElementById('night');
  if (!el) {
    el = h('div', { id: 'night' });
    document.body.insertBefore(el, uiRoot());
  }
  return el;
}

/** Replace an element's children, skipping null/false entries. */
export function setChildren(el: HTMLElement, ...kids: Child[]): void {
  el.replaceChildren();
  append(el, kids);
}
