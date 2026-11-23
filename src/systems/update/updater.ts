import { platform, type UpdateState } from '../../core/platform';
import { settings } from '../../core/settings';

/**
 * Renderer-side view of the updater. All the real work happens in the Electron main
 * process (electron/updater.ts); this keeps the latest state and passes on intents.
 * In the browser there is no updater and everything here is a no-op.
 */
const api = platform?.updater;
let state: UpdateState | null = null;
const listeners = new Set<(s: UpdateState) => void>();

/** Set by the city scene so the game can be saved before an update restarts it. */
export const updaterHooks: { beforeInstall: (() => Promise<unknown>) | null } = { beforeInstall: null };

export const updaterAvailable = (): boolean => !!api;
export const updateState = (): UpdateState | null => state;

export function onUpdateState(fn: (s: UpdateState) => void): () => void {
  listeners.add(fn);
  if (state) fn(state);
  return () => listeners.delete(fn);
}

/** Connect to the main process. Call once at boot, after settings have loaded. */
export async function initUpdater(): Promise<void> {
  if (!api) return;
  api.onState((s) => {
    state = s;
    listeners.forEach((fn) => fn(s));
  });
  try {
    await api.setAutoDownload(settings.autoDownloadUpdates);
    state = await api.getState();
    listeners.forEach((fn) => fn(state!));
  } catch (err) {
    console.warn('Updater unavailable', err);
  }
}

/** Begin background checks. Called when the main menu first appears. */
export const startUpdateChecks = (): void => void api?.start();
export const checkForUpdates = (): void => void api?.check();
export const downloadUpdate = (): void => void api?.download();
export const openReleasePage = (): void => void api?.openReleases();
export const setAutoDownload = (on: boolean): void => void api?.setAutoDownload(on);

/** Save the game if one is running, then restart into the new version. */
export async function restartToUpdate(): Promise<void> {
  if (!api) return;
  try {
    await updaterHooks.beforeInstall?.();
  } catch (err) {
    console.warn('Autosave before update failed', err);
  }
  await api.install();
}

export function formatBytes(n: number | undefined): string {
  if (!n) return '0 MB';
  return n >= 1024 * 1024 * 1024 ? `${(n / 1024 / 1024 / 1024).toFixed(2)} GB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}
