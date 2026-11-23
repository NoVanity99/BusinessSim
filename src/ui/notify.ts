import { bus } from '../core/events';
import { session } from '../core/state';
import { selectLot, selectStaff } from '../core/uiState';
import { clockText, dayOf } from '../systems/time/clock';
import { h, setChildren, uiRoot } from './dom';
import { icon } from './icons';

export type NoteKind = 'info' | 'good' | 'warn' | 'bad';

/** One entry in the notification log. Kept for the session; the saved news feed seeds it on load. */
export interface Note {
  id: number;
  kind: NoteKind;
  text: string;
  day: number;
  time: string;
  /** Where clicking it takes you, worked out from the names it mentions. */
  lotId?: number;
  staffId?: number;
  read: boolean;
}

const MAX_NOTES = 150;
const KIND_ICON: Record<NoteKind, string> = { info: 'info', good: 'check', warn: 'alert', bad: 'alert' };

export const notes: { list: Note[]; unread: number; nextId: number } = { list: [], unread: 0, nextId: 1 };

/**
 * Find what a message is about by looking for the names of the player's shops, rival
 * shops and employees in it. Longest names are tried first so "Corner Cafe 2" is not
 * mistaken for "Corner Cafe".
 */
function targetOf(text: string): { lotId?: number; staffId?: number } {
  const s = session.state;
  if (!s) return {};
  const places: [string, number][] = [...s.shops.map((sh) => [sh.name, sh.lotId] as [string, number]), ...s.rivals.flatMap((c) => c.shops.map((sh) => [sh.name, sh.lotId] as [string, number]))];
  places.sort((a, b) => b[0].length - a[0].length);
  const place = places.find(([name]) => text.includes(name));
  const person = s.staff.find((e) => text.includes(e.name));
  const shopOfPerson = person && person.shopId !== null ? s.shops.find((sh) => sh.id === person.shopId) : undefined;
  return { lotId: place?.[1] ?? shopOfPerson?.lotId, staffId: person?.id };
}

function add(text: string, kind: NoteKind, read = false, day?: number): Note {
  const s = session.state;
  const note: Note = { id: notes.nextId++, kind, text, day: day ?? (s ? dayOf(s.time) : 1), time: day === undefined && s ? clockText(s.time) : '', ...targetOf(text), read };
  notes.list.push(note);
  if (notes.list.length > MAX_NOTES) notes.list.shift();
  if (!read) notes.unread++;
  return note;
}

/** Go to whatever a notification is about. Returns false if it has no place to go. */
export function openNote(note: Note): boolean {
  const s = session.state;
  // The shop may have closed since.
  const lotOk = note.lotId !== undefined && (s.shops.some((sh) => sh.lotId === note.lotId) || s.rivals.some((c) => c.shops.some((sh) => sh.lotId === note.lotId)));
  if (!lotOk) return false;
  bus.emit('camera:focus', note.lotId!);
  selectLot(note.lotId!);
  if (note.staffId !== undefined && s.staff.some((e) => e.id === note.staffId)) selectStaff(note.staffId);
  return true;
}

export function markAllRead(): void {
  for (const n of notes.list) n.read = true;
  notes.unread = 0;
  bus.emit('notes:changed');
}

/**
 * Collects every message the game shows, pops each up as a clickable toast, and keeps
 * the log for the notification window. Returns a cleanup function.
 */
export function mountNotifications(): () => void {
  notes.list = [];
  notes.unread = 0;
  // What happened before this session (from the save) starts out read.
  for (const n of session.state.news) add(n.text, n.kind, true, n.day);

  const box = h('div.toasts');
  uiRoot().append(box);
  const off = bus.on('toast', ({ text, kind }) => {
    const note = add(text, kind ?? 'info');
    const go = note.lotId !== undefined;
    const el = h(
      `div.toast.${note.kind}`,
      {
        class: go ? 'go' : '',
        tip: go ? 'Click to go there' : undefined,
        onclick: () => {
          if (openNote(note)) {
            note.read = true;
            notes.unread = notes.list.filter((n) => !n.read).length;
            bus.emit('notes:changed');
          }
          el.remove();
        },
      },
      icon(KIND_ICON[note.kind], 16),
      h('span', text),
    );
    box.append(el);
    while (box.children.length > 4) box.firstElementChild?.remove();
    setTimeout(() => el.classList.add('out'), 5200);
    setTimeout(() => el.remove(), 5700);
    bus.emit('notes:changed');
  });
  return () => {
    off();
    box.remove();
  };
}

const FILTERS: { id: 'all' | NoteKind; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'bad', label: 'Problems' },
  { id: 'warn', label: 'Warnings' },
  { id: 'good', label: 'Good news' },
  { id: 'info', label: 'Other' },
];
let filter: 'all' | NoteKind = 'all';

/** The notification log: everything that has happened, newest first, filterable and clickable. */
export function notificationsWindow(rerender: () => void): HTMLElement {
  const s = session.state;
  const today = dayOf(s.time);
  const shown = notes.list.filter((n) => filter === 'all' || n.kind === filter).reverse();
  const body = h('div.scroll');
  setChildren(
    body,
    s.events.length > 0 && h('div.section', 'Happening now'),
    ...s.events.map((e) => h('div.kv', h('span.k', e.label), h('span.v', e.untilDay <= today ? 'today' : `${e.untilDay - today} more day${e.untilDay - today === 1 ? '' : 's'}`))),
    h(
      'div.chips',
      ...FILTERS.map((f) => {
        const count = f.id === 'all' ? notes.list.length : notes.list.filter((n) => n.kind === f.id).length;
        return h('button.chip', { class: filter === f.id ? 'active' : '', onclick: () => { filter = f.id; rerender(); } }, `${f.label} ${count}`);
      }),
    ),
    shown.length === 0 && h('div.dim', { style: { fontSize: '13px' } }, 'Nothing here yet.'),
    ...shown.map((n) => {
      const go = n.lotId !== undefined;
      return h(
        `div.note-item.${n.kind}`,
        { class: `${n.read ? '' : 'unread'} ${go ? 'go' : ''}`, tip: go ? 'Click to go there' : undefined, onclick: () => openNote(n) },
        icon(KIND_ICON[n.kind], 16),
        h('div.body', h('div', n.text), h('div.when', `Day ${n.day}${n.time ? ` · ${n.time}` : ''}`)),
      );
    }),
  );
  return body;
}
