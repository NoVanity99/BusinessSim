import { platform } from '../../core/platform';

/**
 * Key/value JSON storage.
 * Electron: files in %APPDATA%/BusinessSim/saves/<key>.json.
 * Browser (npm run dev): localStorage, so the game is testable without Electron.
 * Keys must match [a-zA-Z0-9_-]{1,64}.
 */
export interface Storage {
  read(key: string): Promise<string | null>;
  write(key: string, data: string): Promise<void>;
  remove(key: string): Promise<void>;
  list(): Promise<string[]>;
}

const LS_PREFIX = 'businesssim:';

const browserStorage: Storage = {
  async read(key) {
    return localStorage.getItem(LS_PREFIX + key);
  },
  async write(key, data) {
    localStorage.setItem(LS_PREFIX + key, data);
  },
  async remove(key) {
    localStorage.removeItem(LS_PREFIX + key);
  },
  async list() {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(LS_PREFIX)) keys.push(k.slice(LS_PREFIX.length));
    }
    return keys;
  },
};

export const storage: Storage = platform?.storage ?? browserStorage;

export async function readJson<T>(key: string): Promise<T | null> {
  const raw = await storage.read(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    console.warn(`Storage key "${key}" holds invalid JSON; ignoring it.`);
    return null;
  }
}

export function writeJson(key: string, value: unknown): Promise<void> {
  return storage.write(key, JSON.stringify(value));
}
