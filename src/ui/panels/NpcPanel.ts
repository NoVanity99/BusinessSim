import { bus } from '../../core/events';
import { money } from '../../core/format';
import { session } from '../../core/state';
import { selectNpc, ui } from '../../core/uiState';
import { PRODUCTS, SHOP_TYPES } from '../../data';
import { cartTotal, STATE_LABEL } from '../../entities/Customer';
import { rt } from '../../systems/ai/runtime';
import { h, setChildren } from '../dom';

const USE_LABEL: Record<string, string> = { seat: 'Sit down', ride: 'Go on a ride', play: 'Play a few games', svc_ticket: 'Buy a ticket' };

const moodWord = (m: number): [string, string] =>
  m >= 80 ? ['Delighted', 'good'] : m >= 62 ? ['Happy', 'good'] : m >= 45 ? ['Content', ''] : m >= 28 ? ['Annoyed', 'warn'] : ['Furious', 'bad'];

/** Who is this person, what do they want and what do they think? */
export function NpcPanel(): { el: HTMLElement; destroy(): void } {
  const el = h('div.panel.npc-panel', { style: { display: 'none' } });

  const render = (): void => {
    const c = ui.selectedNpc !== null ? rt.byId.get(ui.selectedNpc) : undefined;
    if (!c) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    const [word, cls] = moodWord(c.mood);
    const now = session.state.time.minutes;
    setChildren(
      el,
      h('h3', h('span', c.name), h('button.close', { onclick: () => selectNpc(null) }, '×')),
      h('div.sub', c.need ? `${STATE_LABEL[c.state]} · looking for a ${SHOP_TYPES[c.need].name.toLowerCase()}` : STATE_LABEL[c.state]),
      h('div.kv', h('span.k', 'Mood'), h('span.v', { class: cls }, word)),
      h('div.meter', h('div', { style: { width: `${c.mood}%`, background: c.mood >= 45 ? 'var(--accent)' : c.mood >= 28 ? 'var(--warn)' : 'var(--danger)' } })),
      h('div.kv', { tip: 'What they can spend on this trip.' }, h('span.k', 'Money'), h('span.v', money(c.budget))),
      h('div.kv', { tip: 'How long they will stand in a queue.' }, h('span.k', 'Patience'), h('span.v', `${Math.round(c.patience)} min`)),
      c.plan.length > 0 && h('div.section', 'Plans'),
      ...c.plan
        .filter((st) => st.t !== 'pay')
        .map((st) => {
          const i = c.plan.indexOf(st);
          const label = st.t === 'buy' ? `Buy ${PRODUCTS[st.product].name.toLowerCase()}` : st.t === 'order' ? `Order ${st.items.map((p) => PRODUCTS[p].name.toLowerCase()).join(', ')}` : st.t === 'use' ? USE_LABEL[st.service] ?? `Use ${PRODUCTS[st.service]?.name.toLowerCase() ?? st.service}` : '';
          const inCart = st.t === 'buy' && c.cart.some((l) => l.product === st.product);
          return h('div.kv', h('span.k', label), h('span.v', { class: inCart ? 'good' : i < c.step ? 'dim' : i === c.step && c.entered ? '' : 'dim' }, inCart ? 'in basket' : i < c.step ? 'done' : i === c.step && c.entered ? 'now' : ''));
        }),
      c.cart.length > 0 && h('div.kv', h('span.k', 'Basket total'), h('span.v', money(cartTotal(c)))),
      h('div.section', 'Thoughts'),
      c.thoughts.length === 0 && h('div.dim', { style: { fontSize: '13px' } }, 'Nothing much on their mind.'),
      ...c.thoughts
        .slice()
        .reverse()
        .map((t) => h('div.thought', { class: t.kind === 'bad' ? 'bad' : t.kind === 'good' ? 'good' : '' }, `"${t.text}"`, h('span.dim', ` ${Math.max(0, Math.round(now - t.t))} min ago`))),
    );
  };

  const timer = window.setInterval(() => ui.selectedNpc !== null && !el.querySelector(':active') && render(), 400);
  const offs = [bus.on('npc:selected', render), bus.on('npc:removed', (id) => id === ui.selectedNpc && selectNpc(null))];
  return {
    el,
    destroy: () => {
      clearInterval(timer);
      offs.forEach((off) => off());
    },
  };
}
