import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater';
import { appendFile, mkdir, stat, rename } from 'node:fs/promises';
import * as path from 'node:path';

/**
 * In-game updater, main-process side. Talks to GitHub Releases through electron-updater
 * and mirrors its progress to the game window as a single state object.
 * The renderer never touches the network or the file system for updates; it only
 * sends the intents registered at the bottom of this file.
 *
 * Keep UpdateState in sync with src/core/platform.ts.
 */
export type UpdateStatus = 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'uptodate' | 'error';

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  /** Why updates are off, when status is 'disabled'. */
  reason?: string;
  /** The newer version on offer. */
  version?: string;
  /** Release notes as plain text. */
  notes?: string;
  percent?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  /** A message fit to show a player. */
  error?: string;
  /** The single-file build cannot replace itself; it only points at the download page. */
  portable: boolean;
  autoDownload: boolean;
  /** Epoch ms of the last completed check. */
  lastChecked?: number;
}

const RELEASES_URL = 'https://github.com/NoVanity99/BusinessSim/releases/latest';
const FIRST_CHECK_DELAY_MS = 4_000;
const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 30_000;
const MAX_LOG_BYTES = 512 * 1024;

const portable = !!process.env.PORTABLE_EXECUTABLE_FILE;
let win: (() => BrowserWindow | null) | null = null;
let started = false;
let busy = false;
let state: UpdateState = { status: 'idle', currentVersion: app.getVersion(), portable, autoDownload: true };

// ---------- Logging ----------

const logFile = (): string => path.join(app.getPath('userData'), 'logs', 'updater.log');
let logQueue: Promise<void> = Promise.resolve();

/** Append a line to %APPDATA%/BusinessSim/logs/updater.log. Never throws. */
function log(level: 'info' | 'warn' | 'error', ...parts: unknown[]): void {
  const text = parts.map((p) => (p instanceof Error ? p.stack ?? p.message : typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  const line = `${new Date().toISOString()} [${level}] ${text}\n`;
  logQueue = logQueue
    .then(async () => {
      const file = logFile();
      await mkdir(path.dirname(file), { recursive: true });
      // Keep one previous log so the file cannot grow without limit.
      const size = await stat(file).then((s) => s.size, () => 0);
      if (size > MAX_LOG_BYTES) await rename(file, `${file}.old`).catch(() => undefined);
      await appendFile(file, line, 'utf8');
    })
    .catch(() => undefined);
}

// ---------- State ----------

function setState(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch };
  const w = win?.();
  if (w && !w.isDestroyed()) w.webContents.send('updater:state', state);
}

/** Release notes arrive as HTML or a list of them; the game shows plain text. */
function plainNotes(info: UpdateInfo): string {
  const raw = Array.isArray(info.releaseNotes) ? info.releaseNotes.map((n) => `${n.version}\n${n.note ?? ''}`).join('\n\n') : info.releaseNotes ?? '';
  return raw
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<\/\s*(p|li|h\d|ul|ol|div)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 6000);
}

/** Turn a technical failure into something a player can act on. */
function friendly(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN|ERR_NETWORK_CHANGED|ERR_CONNECTION|ETIMEDOUT|ECONNRESET|ERR_TIMED_OUT/i.test(msg)) {
    return 'Could not reach the update server. Check your internet connection and try again later.';
  }
  if (/\b403\b|rate limit/i.test(msg)) return 'GitHub is limiting requests right now. Try again in a little while.';
  if (/\b404\b|latest\.yml|No published versions|Unable to find latest version/i.test(msg)) return 'No update information was found. There may be no releases yet.';
  if (/sha512|checksum|signature/i.test(msg)) return 'The download did not arrive intact. Please try again.';
  if (/ENOSPC/i.test(msg)) return 'There is not enough disk space to download the update.';
  return 'The update could not be completed. You can keep playing and try again later.';
}

// ---------- Actions ----------

async function check(manual: boolean): Promise<void> {
  if (state.status === 'disabled' || busy) return;
  // Do not disturb a download in progress or one already waiting to install.
  if (state.status === 'downloading' || state.status === 'downloaded') return;
  busy = true;
  log('info', `Checking for updates (${manual ? 'manual' : 'automatic'}), current ${state.currentVersion}`);
  if (manual || state.status !== 'available') setState({ status: 'checking', error: undefined });
  let timer: NodeJS.Timeout | undefined;
  try {
    // A dead connection can leave the request hanging; give up after a while so the
    // player is never stuck on "Checking" and can try again.
    const result = await Promise.race([
      autoUpdater.checkForUpdates(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('ETIMEDOUT: the update check took too long')), CHECK_TIMEOUT_MS);
      }),
    ]);
    // The library reports results through events. If it returned without any, either this
    // kind of build cannot update itself (null) or there is simply nothing to report.
    if (state.status === 'checking') {
      if (result == null) {
        log('warn', 'This build cannot update itself; turning update checks off.');
        setState({ status: 'disabled', reason: 'This build cannot update itself. Download new versions from the release page.' });
      } else setState({ status: 'idle' });
    }
  } catch (err) {
    log('error', 'Check failed:', err);
    // A background check that fails stays quiet; only a check the player asked for reports it.
    if (manual) setState({ status: 'error', error: friendly(err) });
    else if (state.status === 'checking') setState({ status: 'idle' });
  } finally {
    clearTimeout(timer);
    busy = false;
  }
}

async function download(): Promise<void> {
  if (state.status !== 'available' || portable) return;
  log('info', `Downloading ${state.version}`);
  setState({ status: 'downloading', percent: 0, bytesPerSecond: 0, transferred: 0, error: undefined });
  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    log('error', 'Download failed:', err);
    setState({ status: 'error', error: friendly(err) });
  }
}

function install(): void {
  if (state.status !== 'downloaded') return;
  log('info', `Restarting to install ${state.version}`);
  // Silent install, then relaunch the game.
  autoUpdater.quitAndInstall(true, true);
}

// ---------- Wiring ----------

export function initUpdater(getWindow: () => BrowserWindow | null): void {
  win = getWindow;

  if (!app.isPackaged) {
    // `npm run dev` and `npm start`: there is nothing to update.
    state = { ...state, status: 'disabled', reason: 'Updates are turned off in development builds.' };
  } else {
    autoUpdater.logger = { info: (m: unknown) => log('info', m), warn: (m: unknown) => log('warn', m), error: (m: unknown) => log('error', m), debug: () => undefined };
    autoUpdater.autoDownload = false; // decided per update in 'update-available'
    autoUpdater.autoInstallOnAppQuit = true; // "Later" means: install when the game is next closed
    autoUpdater.allowDowngrade = false;

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      log('info', `Update available: ${info.version}`);
      setState({ status: 'available', version: info.version, notes: plainNotes(info), lastChecked: Date.now(), error: undefined });
      if (state.autoDownload && !portable) void download();
    });
    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      log('info', `Up to date (latest is ${info.version})`);
      setState({ status: 'uptodate', lastChecked: Date.now(), error: undefined });
    });
    autoUpdater.on('download-progress', (p: ProgressInfo) => {
      setState({ status: 'downloading', percent: p.percent, bytesPerSecond: p.bytesPerSecond, transferred: p.transferred, total: p.total });
    });
    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      log('info', `Downloaded ${info.version}; will install on restart or quit`);
      setState({ status: 'downloaded', version: info.version, percent: 100 });
    });
    autoUpdater.on('error', (err: Error) => {
      // check() and download() report their own failures; this catches anything else.
      log('error', 'Updater error:', err);
      if (state.status === 'downloading') setState({ status: 'error', error: friendly(err) });
    });
  }

  ipcMain.handle('updater:getState', () => state);
  ipcMain.handle('updater:check', () => check(true));
  ipcMain.handle('updater:download', () => download());
  ipcMain.handle('updater:install', () => install());
  ipcMain.handle('updater:setAutoDownload', (_e, on: boolean) => {
    autoUpdater.autoDownload = false;
    setState({ autoDownload: !!on });
    // Turning it on with an update already found starts the download.
    if (on && state.status === 'available' && !portable) void download();
  });
  // The renderer cannot pass a URL: this only ever opens the project's release page.
  ipcMain.handle('updater:openReleases', () => shell.openExternal(RELEASES_URL));
  // Called once the main menu is on screen, so checking never delays startup.
  ipcMain.handle('updater:start', () => {
    if (started || state.status === 'disabled') return;
    started = true;
    log('info', `Updater started. Version ${state.currentVersion}, ${portable ? 'portable' : 'installed'} build`);
    setTimeout(() => void check(false), FIRST_CHECK_DELAY_MS);
    setInterval(() => void check(false), RECHECK_INTERVAL_MS);
  });
}
