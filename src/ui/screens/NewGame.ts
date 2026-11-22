import { money } from '../../core/format';
import type { NewGameOptions } from '../../core/state';
import { DIFFICULTIES } from '../../data';
import { h } from '../dom';

export function NewGame(actions: { onStart(opts: NewGameOptions): void; onBack(): void }): HTMLElement {
  let difficulty = 'normal';
  const name = h('input', { type: 'text', value: 'Pocket Change Inc.', maxLength: 28 });
  const cards = h('div.cards');

  const render = (): void => {
    cards.replaceChildren(
      ...Object.entries(DIFFICULTIES).map(([id, d]) =>
        h(
          'div.card',
          {
            class: id === difficulty ? 'selected' : '',
            onclick: () => {
              difficulty = id;
              render();
            },
          },
          h('h3', d.name),
          h('p', d.description),
          h('div.big', money(d.startingMoney)),
          h('div.sub', { style: { color: 'var(--dim)', fontSize: '12px', marginTop: '4px' } }, `Goal: ${money(d.netWorthGoal)} net worth`),
        ),
      ),
    );
  };
  render();

  const start = (): void => actions.onStart({ companyName: name.value, difficulty });
  name.addEventListener('keydown', (e) => e.key === 'Enter' && start());

  return h(
    'div.screen',
    h('h2', 'New Game'),
    h('div.form-row', h('label', 'Company name'), name),
    h('div.form-row', { style: { width: 'auto' } }, h('label', 'Starting money and difficulty'), cards),
    h('div.row', { style: { marginTop: '14px' } }, h('button', { onclick: actions.onBack }, 'Back'), h('button.primary', { onclick: start, style: { padding: '9px 28px' } }, 'Start')),
  );
}
