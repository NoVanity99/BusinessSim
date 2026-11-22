import { SAVE_VERSION } from '../../core/constants';
import { bus, toast } from '../../core/events';
import { session, type GameState } from '../../core/state';
import { settings } from '../../core/settings';
import { emptyStats } from '../../entities/Shop';
import { generateCity } from '../city/generate';
import { netWorth } from '../economy/networth';
import { dayOf } from '../time/clock';
import { readJson, storage, writeJson } from './storage';

export const SLOTS = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5'] as const;
export const AUTOSAVE = 'autosave';
const keyOf = (slot: string): string => `save_${slot}`;

export interface SaveMeta {
  slot: string;
  company: string;
  difficulty: string;
  day: number;
  money: number;
  netWorth: number;
  shops: number;
  /** Real-world time the save was written (ISO string). */
  savedAt: string;
}

interface SaveFile {
  version: number;
  meta: SaveMeta;
  state: GameState;
}

export async function saveGame(slot: string, quiet = false): Promise<boolean> {
  const s = session.state;
  if (!s) return false;
  const file: SaveFile = {
    version: SAVE_VERSION,
    meta: {
      slot,
      company: s.companyName,
      difficulty: s.difficulty,
      day: dayOf(s.time),
      money: Math.round(s.money),
      netWorth: Math.round(netWorth(s, session.city)),
      shops: s.shops.length,
      savedAt: new Date().toISOString(),
    },
    state: s,
  };
  try {
    await writeJson(keyOf(slot), file);
    if (!quiet) toast(slot === AUTOSAVE ? 'Autosaved.' : 'Game saved.', 'good');
    return true;
  } catch (err) {
    toast(`Saving failed: ${(err as Error).message}`, 'bad');
    return false;
  }
}

export async function listSaves(): Promise<SaveMeta[]> {
  const out: SaveMeta[] = [];
  for (const slot of [AUTOSAVE, ...SLOTS]) {
    const file = await readJson<SaveFile>(keyOf(slot));
    if (file?.meta && file.state) out.push({ ...file.meta, slot });
  }
  return out;
}

export async function latestSave(): Promise<SaveMeta | null> {
  const all = await listSaves();
  all.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  return all[0] ?? null;
}

export function deleteSave(slot: string): Promise<void> {
  return storage.remove(keyOf(slot));
}

/** Fill in anything an older save lacks, so every system can rely on the current shape. */
function migrate(s: GameState): GameState {
  s.shops ??= [];
  s.orders ??= [];
  s.staff ??= [];
  s.candidates ??= [];
  s.nextPersonId ??= 1;
  for (const shop of s.shops) {
    shop.dirt ??= 0;
    shop.autoReorder ??= true;
    shop.today = { ...emptyStats(), ...shop.today };
    shop.yesterday = { ...emptyStats(), ...shop.yesterday };
  }
  s.version = SAVE_VERSION;
  return s;
}

/** Load a slot into the session. The caller then (re)starts the city scene. */
export async function loadGame(slot: string): Promise<boolean> {
  const file = await readJson<SaveFile>(keyOf(slot));
  if (!file?.state) return false;
  if (file.version > SAVE_VERSION) {
    console.warn(`Save "${slot}" was written by a newer version of the game.`);
    return false;
  }
  session.state = migrate(file.state);
  session.city = generateCity();
  return true;
}

/** Autosave at 06:00 every game day. Returns a cleanup function. */
export function installAutosave(): () => void {
  return bus.on('time:hour', (hour) => {
    if (hour === 6 && settings.autosave) void saveGame(AUTOSAVE);
  });
}
