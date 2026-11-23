import { money } from '../../core/format';
import type { NewGameOptions } from '../../core/state';
import { DIFFICULTIES } from '../../data';
import { SANDBOX, SCENARIOS } from '../../systems/progress/scenarios';
import { h } from '../dom';

type Mode = 'career' | 'scenario' | 'sandbox';

/** Start a career at a chosen difficulty, take on a scenario with a goal and a deadline, or play the sandbox. */
export function NewGame(actions: { onStart(opts: NewGameOptions): void; onBack(): void }): HTMLElement {
  let mode: Mode = 'career';
  let difficulty = 'normal';
  let scenarioId = SCENARIOS[0].id;
  const name = h('input', { type: 'text', value: 'Pocket Change Inc.', maxLength: 28 });
  const body = h('div');
  const tabs = h('div.segmented');

  const card = (selected: boolean, onclick: () => void, title: string, text: string, big: string, small: string): HTMLElement =>
    h('div.card', { class: selected ? 'selected' : '', onclick }, h('h3', title), h('p', text), h('div.big', big), h('div.sub', { style: { color: 'var(--dim)', fontSize: '12px', marginTop: '4px' } }, small));

  // Goals are described with the same words the in-game tracker uses, without needing a game to exist.
  const goalText = (id: string): string => {
    const g = SCENARIOS.find((x) => x.id === id)!.goals;
    const parts: string[] = [];
    if (g.netWorth) parts.push(`${money(g.netWorth)} net worth`);
    if (g.shops) parts.push(`${g.shops} businesses`);
    if (g.shopsOfType) parts.push(`${g.shopsOfType.count} of one kind`);
    if (g.served) parts.push(`${g.served.toLocaleString()} customers served`);
    if (g.franchises) parts.push(`${g.franchises} franchises`);
    if (g.noLoans) parts.push('no debt');
    if (g.topCompany) parts.push('worth more than every rival');
    return parts.join(', ');
  };

  const render = (): void => {
    tabs.replaceChildren(
      ...([['career', 'Career'], ['scenario', 'Scenarios'], ['sandbox', 'Sandbox']] as [Mode, string][]).map(([id, label]) => h('button', { class: mode === id ? 'active' : '', onclick: () => { mode = id; render(); } }, label)),
    );
    if (mode === 'career') {
      body.replaceChildren(
        h('div.form-row', { style: { width: 'auto' } }, h('label', 'Starting money and difficulty'), h('div.cards', ...Object.entries(DIFFICULTIES).map(([id, d]) => card(id === difficulty, () => { difficulty = id; render(); }, d.name, d.description, money(d.startingMoney), `Goal: ${money(d.netWorthGoal)} net worth`)))),
      );
    } else if (mode === 'scenario') {
      body.replaceChildren(
        h('div.form-row', { style: { width: 'auto' } }, h('label', 'Choose a challenge'), h('div.cards.wrap', ...SCENARIOS.map((sc) => card(sc.id === scenarioId, () => { scenarioId = sc.id; render(); }, sc.name, sc.description, `${sc.days} days`, `Goal: ${goalText(sc.id)}`)))),
      );
    } else {
      body.replaceChildren(h('div.form-row', { style: { width: 'auto' } }, h('label', 'Free play'), h('div.cards', card(true, () => undefined, SANDBOX.name, SANDBOX.description, money(SANDBOX.money), 'No goal, no deadline'))));
    }
  };
  render();

  const start = (): void => actions.onStart({ companyName: name.value, difficulty, mode, scenarioId: mode === 'scenario' ? scenarioId : undefined });
  name.addEventListener('keydown', (e) => e.key === 'Enter' && start());

  return h(
    'div.screen',
    h('h2', 'New Game'),
    h('div.form-row', h('label', 'Company name'), name),
    tabs,
    body,
    h('div.row', { style: { marginTop: '14px' } }, h('button', { onclick: actions.onBack }, 'Back'), h('button.primary', { onclick: start, style: { padding: '9px 28px' } }, 'Start')),
  );
}
