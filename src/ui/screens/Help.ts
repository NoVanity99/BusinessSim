import { ACTIONS, keyLabel, settings, type Action } from '../../core/settings';
import { h } from '../dom';

const key = (label: string): HTMLElement => h('kbd', label);

const FIXED: [string[], string][] = [
  [['Arrows'], 'Move the camera'],
  [['Mouse wheel'], 'Zoom toward the pointer'],
  [['Drag'], 'Move the camera (middle or right button while building)'],
  [['Ctrl', 'Z'], 'Undo the last build action'],
  [['Ctrl', 'Y'], 'Redo'],
  [['C'], 'Copy tool, while building'],
  [['Right-click'], 'Put the build tool away'],
  [['Enter'], 'Take the picture, in photo mode'],
  [['F11'], 'Fullscreen'],
];

const TIPS: [string, string][] = [
  ['Customers', 'Click anyone to see who they are, what they need, what they think of your shops and what they plan to do.'],
  ['Prices', 'Each resident compares your prices, reputation and distance with rival shops before choosing. Price-conscious people walk further for a bargain.'],
  ['Staff', 'Each role works down a list of jobs. Reorder the list per shop on the task board in the Staff tab, and drag shifts on the Staff screen.'],
  ['Building', 'Click to place one piece, drag to lay out a row. Layouts can be saved as templates and built in another shop of the same kind.'],
  ['Thieves', 'Staff, cameras and guards all make a thief likelier to be seen; only a guard can catch one. The theft risk overlay shows where you are exposed.'],
  ['Notifications', 'Everything that happens is kept under the bell. Messages about a shop, a rival or an employee take you there when clicked.'],
];

/** Controls and a few things worth knowing, shown over the game. */
export function HelpWindow(onClose: () => void): HTMLElement {
  const bound = (Object.keys(ACTIONS) as Action[]).map((a) => h('div.kv', h('span.k', ACTIONS[a]), h('span.v', key(keyLabel(settings.keys[a])))));
  return h(
    'div.overlay',
    { onclick: (e: Event) => e.target === e.currentTarget && onClose() },
    h(
      'div.panel.window.wide.help',
      { style: { position: 'relative' } },
      h('h2', 'Controls and help'),
      h(
        'div.scroll',
        h(
          'div.dash-row',
          h('div', h('div.section', 'Keys you can change in Settings'), ...bound),
          h('div', h('div.section', 'Always'), ...FIXED.map(([keys, what]) => h('div.kv', h('span.k', what), h('span.v', ...keys.map(key)))), h('div.section', 'Good to know'), ...TIPS.map(([title, text]) => h('div.tip', h('b', `${title}. `), text))),
        ),
      ),
      h('div.row', { style: { marginTop: '12px', justifyContent: 'flex-end' } }, h('button.primary', { onclick: onClose }, 'Close')),
    ),
  );
}
