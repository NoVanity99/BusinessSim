import { bus } from '../../core/events';
import { saveSettings, settings } from '../../core/settings';
import { session, type GameState } from '../../core/state';
import { batchQty, registers } from '../../entities/Shop';
import { h, setChildren } from '../dom';

interface GuideStep {
  text: string;
  hint: string;
  done(s: GameState): boolean;
  /** The control to point at for this step, if it is on screen. */
  target?(s: GameState): Element | null;
}

const q = (sel: string): Element | null => document.querySelector(sel);
/** A button inside `scope` whose label starts with `text` and can be pressed. */
const button = (scope: string, text: string): Element | null => [...document.querySelectorAll(`${scope} button`)].find((b) => (b.textContent ?? '').trim().startsWith(text) && !(b as HTMLButtonElement).disabled) ?? null;
const tabOpen = (name: string): boolean => (q('.shop-panel .tabs button.active')?.textContent ?? '') === name;
const tab = (name: string): Element | null => (tabOpen(name) ? null : button('.shop-panel .tabs', name));

/** The first things a new player needs to do, checked against the live game. */
const STEPS: GuideStep[] = [
  {
    text: 'Rent a lot',
    hint: 'Click a lot with a yellow outline, then Rent. Cheap, quiet areas are a safe start.',
    done: (s) => Object.keys(s.lots).length > 0 || s.shops.length > 0,
    target: () => button('.lot-panel', 'Rent'),
  },
  {
    text: 'Open a convenience store',
    hint: 'With your lot selected, press Open Convenience Store.',
    done: (s) => s.shops.length > 0,
    target: () => button('.lot-panel', 'Open Convenience'),
  },
  {
    text: 'Place a shelf and a checkout',
    hint: 'Open the Build tab. The quickest way is the Starter store layout at the bottom; or pick pieces yourself. R rotates, and the yellow square is where customers stand.',
    done: (s) => s.shops.some((sh) => registers(sh).length > 0 && sh.objects.some((o) => o.slots)),
    target: () => tab('Build') ?? button('.shop-panel .template', 'Build'),
  },
  {
    text: 'Order stock',
    hint: 'Stock tab. Add a few cases and place the order. Express arrives in two hours.',
    done: (s) => s.orders.length > 0 || s.shops.some((sh) => Object.values(sh.storage).some((b) => batchQty(b) > 0) || sh.objects.some((o) => o.slots?.some((sl) => batchQty(sl.batches) > 0))),
    target: () => tab('Stock') ?? button('.shop-panel', 'Place order'),
  },
  {
    text: 'Fill a shelf',
    hint: 'When the delivery arrives, click a shelf in your shop, choose a product for each section and press Fill. The starter layout labels its shelves for you.',
    done: (s) => s.shops.some((sh) => sh.objects.some((o) => o.slots?.some((sl) => batchQty(sl.batches) > 0))),
    target: () => button('.object-panel', 'Fill'),
  },
  {
    text: 'Make your first sale',
    hint: 'Let time run and wait. You work the first checkout yourself. Click customers to see what they think.',
    done: (s) => s.shops.some((sh) => sh.today.revenue > 0 || sh.yesterday.revenue > 0),
    target: (s) => (s.time.speed === 0 ? q('.topbar .speed button:nth-child(2)') : null),
  },
  {
    text: 'Hire someone',
    hint: 'Staff tab. A cashier frees you from the till and restocks when it is quiet; you set what each role does first on the task board there.',
    done: (s) => s.staff.length > 0,
    target: () => tab('Staff') ?? button('.shop-panel .person', 'Hire'),
  },
  {
    text: 'Look at your dashboard',
    hint: 'The sidebar on the left has your businesses, each shop\'s dashboard, stock, finances and staff. Press F1 at any time for the controls.',
    done: (s) => s.level >= 2 || s.shops.some((sh) => sh.history.length > 0),
    target: () => q('.sidebar button:nth-child(2)'),
  },
];

/**
 * A checklist for the first game that points at the control to use next. It removes
 * itself once every step is done or it is dismissed, and can be brought back in Settings.
 */
export function Guide(): { el: HTMLElement; destroy(): void } {
  const s = session.state;
  const el = h('div.panel.guide');
  // The pointer lives outside the scaled interface so it can use screen coordinates directly.
  const spot = h('div.spot');
  document.body.append(spot);
  let dismissed = settings.tutorialDone || STEPS.every((st) => st.done(s));

  const finish = (): void => {
    dismissed = true;
    if (!settings.tutorialDone) {
      settings.tutorialDone = true;
      saveSettings();
    }
  };

  let current = -1;
  const point = (): void => {
    const target = !dismissed && current >= 0 ? STEPS[current].target?.(s) ?? null : null;
    if (!target) {
      spot.style.display = 'none';
      return;
    }
    const r = target.getBoundingClientRect();
    spot.style.display = 'block';
    spot.style.left = `${r.left - 5}px`;
    spot.style.top = `${r.top - 5}px`;
    spot.style.width = `${r.width + 10}px`;
    spot.style.height = `${r.height + 10}px`;
  };

  const render = (): void => {
    if (!dismissed) current = STEPS.findIndex((st) => !st.done(s));
    if (!dismissed && current < 0) finish();
    if (dismissed) {
      el.style.display = 'none';
      return point();
    }
    setChildren(
      el,
      h('h3', h('span', `Getting started · ${current + 1}/${STEPS.length}`), h('button.close', { onclick: () => { finish(); render(); }, tip: 'Hide the tutorial. You can turn it back on in Settings.' }, '×')),
      ...STEPS.map((st, i) => h('div.step', { class: i < current ? 'done' : i === current ? 'now' : '' }, h('span.mark', i < current ? '✓' : i === current ? '▸' : '·'), st.text)),
      h('div.note', STEPS[current].hint),
      h('div.row', { style: { marginTop: '6px', justifyContent: 'flex-end' } }, h('button', { onclick: () => bus.emit('help:open') }, 'Controls (F1)')),
    );
    point();
  };

  render();
  const timer = window.setInterval(() => !el.querySelector(':active') && render(), 1000);
  const fast = window.setInterval(point, 200);
  const offs = [bus.on('shop:created', render), bus.on('lot:changed', render), bus.on('lot:selected', () => setTimeout(point, 50))];
  return {
    el,
    destroy: () => {
      clearInterval(timer);
      clearInterval(fast);
      spot.remove();
      offs.forEach((off) => off());
    },
  };
}
