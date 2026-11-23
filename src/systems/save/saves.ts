import { SAVE_VERSION } from '../../core/constants';
import { bus, toast } from '../../core/events';
import { session, type GameState } from '../../core/state';
import { settings } from '../../core/settings';
import { migrateState, SaveTooNewError } from './migrations';
import { APP_VERSION } from '../../core/platform';
import { generateCity } from '../city/generate';
import { netWorth } from '../economy/networth';
import { dayOf } from '../time/clock';
import { readJson, storage, writeJson } from './storage';

export const SLOTS = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6', 'slot7', 'slot8', 'slot9', 'slot10'] as const;

/** Supplies a small picture of the game as it looks now, if there is a screen to take one from. */
let thumbProvider: (() => Promise<string | undefined>) | null = null;
export function setThumbProvider(fn: typeof thumbProvider): void {
  thumbProvider = fn;
}
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
  /** A small JPEG of the city when it was saved, as a data URL. */
  thumb?: string;
  mode?: string;
  scenario?: string;
}

interface SaveFile {
  /** Save format, see migrations.ts. */
  version: number;
  /** Game release that wrote the file, for support. */
  gameVersion?: string;
  meta: SaveMeta;
  state: GameState;
}

export async function saveGame(slot: string, quiet = false): Promise<boolean> {
  const s = session.state;
  if (!s) return false;
  const thumb = await thumbProvider?.().catch(() => undefined);
  const file: SaveFile = {
    version: SAVE_VERSION,
    gameVersion: APP_VERSION,
    meta: {
      slot,
      company: s.companyName,
      difficulty: s.difficulty,
      day: dayOf(s.time),
      money: Math.round(s.money),
      netWorth: Math.round(netWorth(s, session.city)),
      shops: s.shops.length,
      savedAt: new Date().toISOString(),
      thumb,
      mode: s.mode,
      scenario: s.scenario?.id,
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

/** Slots hold saves; backups written before a migration are not listed. */
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

export type LoadResult = { ok: true; migrated: string[] } | { ok: false; reason: string };

/**
 * Load a slot into the session. The caller then (re)starts the city scene.
 * Older saves are upgraded step by step; the original file is kept as a backup first.
 */
export async function loadGameDetailed(slot: string): Promise<LoadResult> {
  const file = await readJson<SaveFile>(keyOf(slot));
  if (!file?.state) return { ok: false, reason: 'That save is missing or unreadable.' };
  const from = file.version ?? 1;
  let migrated: string[];
  try {
    if (from < SAVE_VERSION) {
      // Keep the untouched original so a bad migration can never destroy a save.
      await writeJson(`backup_${slot}_v${from}`, file).catch(() => undefined);
    }
    migrated = migrateState(file.state, from);
  } catch (err) {
    if (err instanceof SaveTooNewError) return { ok: false, reason: err.message };
    console.error('Save migration failed', err);
    return { ok: false, reason: 'That save could not be upgraded to this version of the game. The original file has not been changed.' };
  }
  if (migrated.length) console.info(`Upgraded save "${slot}" from format ${from}:`, migrated);
  session.state = file.state;
  session.city = generateCity();
  return { ok: true, migrated };
}

export async function loadGame(slot: string): Promise<boolean> {
  return (await loadGameDetailed(slot)).ok;
}

/** Autosave at 06:00 every game day. Returns a cleanup function. */
export function installAutosave(): () => void {
  return bus.on('time:hour', (hour) => {
    if (hour === 6 && settings.autosave) void saveGame(AUTOSAVE);
  });
}
