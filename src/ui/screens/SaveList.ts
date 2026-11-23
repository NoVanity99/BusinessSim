import { money } from '../../core/format';
import { DIFFICULTIES } from '../../data';
import { AUTOSAVE, deleteSave, listSaves, SLOTS, type SaveMeta } from '../../systems/save/saves';
import { h, setChildren } from '../dom';

const slotName = (slot: string): string => (slot === AUTOSAVE ? 'Autosave' : `Slot ${slot.replace('slot', '')}`);

/**
 * Lists save slots. In 'load' mode only filled slots are offered; in 'save' mode every
 * manual slot is, with a confirmation before overwriting.
 */
export function SaveList(mode: 'load' | 'save', onPick: (slot: string) => void, onBack: () => void): HTMLElement {
  const list = h('div.saves', h('div.dim', 'Reading saves…'));

  const refresh = async (): Promise<void> => {
    const saves = await listSaves();
    const bySlot = new Map<string, SaveMeta>(saves.map((m) => [m.slot, m]));
    const slots = mode === 'load' ? [AUTOSAVE, ...SLOTS].filter((sl) => bySlot.has(sl)) : [...SLOTS];
    setChildren(
      list,
      slots.length === 0 && h('div.dim', 'No saved games yet.'),
      ...slots.map((slot) => {
        const m = bySlot.get(slot);
        return h(
          'div.save',
          m?.thumb ? h('img.thumb', { src: m.thumb, alt: '' }) : h('div.thumb.empty'),
          h(
            'div',
            { style: { flex: '1', minWidth: '0' } },
            h('div', h('b', slotName(slot)), m ? ` · ${m.company}` : ''),
            h('div.dim', { style: { fontSize: '12.5px' } }, m ? `${m.mode === 'sandbox' ? 'Sandbox · ' : m.mode === 'scenario' ? 'Scenario · ' : ''}Day ${m.day} · ${money(m.money)} cash · ${m.shops} shop${m.shops === 1 ? '' : 's'} · ${DIFFICULTIES[m.difficulty]?.name ?? ''} · ${new Date(m.savedAt).toLocaleString()}` : 'Empty'),
          ),
          h('button.primary', { onclick: () => { if (mode === 'load' || !m || confirm(`Overwrite ${slotName(slot)}?`)) onPick(slot); } }, mode === 'load' ? 'Load' : 'Save here'),
          m && h('button.danger', { tip: 'Delete this save', onclick: async () => { if (confirm(`Delete ${slotName(slot)}? This cannot be undone.`)) { await deleteSave(slot); void refresh(); } } }, 'Delete'),
        );
      }),
    );
  };
  void refresh();

  return h('div.window-body', list, h('div.row', { style: { marginTop: '12px' } }, h('button', { onclick: onBack }, 'Back')));
}
