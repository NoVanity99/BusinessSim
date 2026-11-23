import { bus } from '../../core/events';
import { session, type GameState } from '../../core/state';
import { batchQty, registers } from '../../entities/Shop';
import { h, setChildren } from '../dom';

interface GuideStep {
  text: string;
  hint: string;
  done(s: GameState): boolean;
}

/** The first few things a new player needs to do, checked against the live game. */
const STEPS: GuideStep[] = [
  { text: 'Rent a lot', hint: 'Click a lot with a yellow outline, then Rent. Cheap, quiet areas are a safe start.', done: (s) => Object.keys(s.lots).length > 0 || s.shops.length > 0 },
  { text: 'Open a convenience store', hint: 'With your lot selected, press Open Convenience Store.', done: (s) => s.shops.length > 0 },
  { text: 'Place a shelf and a checkout', hint: 'Build tab. R rotates. The yellow square is where customers stand, so keep it clear.', done: (s) => s.shops.some((sh) => registers(sh).length > 0 && sh.objects.some((o) => o.slots)) },
  { text: 'Order stock', hint: 'Stock tab. Add a few cases and place the order. Express arrives in two hours.', done: (s) => s.orders.length > 0 || s.shops.some((sh) => Object.values(sh.storage).some((b) => batchQty(b) > 0) || sh.objects.some((o) => o.slots?.some((sl) => batchQty(sl.batches) > 0))) },
  { text: 'Fill a shelf', hint: 'When the delivery arrives, click the shelf, choose a product for each section and press Fill.', done: (s) => s.shops.some((sh) => sh.objects.some((o) => o.slots?.some((sl) => batchQty(sl.batches) > 0))) },
  { text: 'Make your first sale', hint: 'Unpause and wait. You work the first checkout yourself. Click customers to see what they think.', done: (s) => s.shops.some((sh) => sh.today.revenue > 0 || sh.yesterday.revenue > 0) },
  { text: 'Reach level 2', hint: 'Keep shelves full and prices fair. New business types unlock as you level up.', done: (s) => s.level >= 2 },
];

/** A small checklist for the first game. It removes itself once every step is done or it is dismissed. */
export function Guide(): { el: HTMLElement; destroy(): void } {
  const s = session.state;
  const el = h('div.panel.guide');
  let dismissed = STEPS.every((st) => st.done(s));

  const render = (): void => {
    if (dismissed) {
      el.style.display = 'none';
      return;
    }
    const current = STEPS.findIndex((st) => !st.done(s));
    if (current < 0) {
      dismissed = true;
      el.style.display = 'none';
      return;
    }
    setChildren(
      el,
      h('h3', h('span', 'Getting started'), h('button.close', { onclick: () => { dismissed = true; render(); }, tip: 'Hide this checklist' }, '×')),
      ...STEPS.map((st, i) => h('div.step', { class: i < current ? 'done' : i === current ? 'now' : '' }, h('span.mark', i < current ? '✓' : i === current ? '▸' : '·'), st.text)),
      h('div.note', STEPS[current].hint),
    );
  };

  render();
  const timer = window.setInterval(() => !el.querySelector(':active') && render(), 1000);
  const offs = [bus.on('shop:created', render), bus.on('lot:changed', render)];
  return {
    el,
    destroy: () => {
      clearInterval(timer);
      offs.forEach((off) => off());
    },
  };
}
