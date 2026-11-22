import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
let win: BrowserWindow | null = null;

/** %APPDATA%/BusinessSim/saves on Windows. */
function savesDir(): string {
  return path.join(app.getPath('userData'), 'saves');
}

/** Keys become file names, so only allow a safe character set. */
function fileFor(key: string): string {
  if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(key)) {
    throw new Error(`Invalid storage key: ${String(key)}`);
  }
  return path.join(savesDir(), `${key}.json`);
}

function registerIpc(): void {
  ipcMain.handle('storage:read', async (_e, key: string) => {
    try {
      return await fs.readFile(fileFor(key), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  });

  ipcMain.handle('storage:write', async (_e, key: string, data: string) => {
    if (typeof data !== 'string') throw new Error('Save data must be a string');
    const file = fileFor(key);
    await fs.mkdir(savesDir(), { recursive: true });
    // Write to a temp file first so a crash mid-write cannot corrupt a save.
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, data, 'utf8');
    await fs.rename(tmp, file);
  });

  ipcMain.handle('storage:remove', async (_e, key: string) => {
    await fs.rm(fileFor(key), { force: true });
  });

  ipcMain.handle('storage:list', async () => {
    try {
      const names = await fs.readdir(savesDir());
      return names.filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  });

  ipcMain.handle('window:setFullscreen', (_e, on: boolean) => {
    win?.setFullScreen(!!on);
  });
  ipcMain.handle('window:isFullscreen', () => win?.isFullScreen() ?? false);
  ipcMain.handle('window:setSize', (_e, w: number, h: number) => {
    if (!win || !Number.isFinite(w) || !Number.isFinite(h)) return;
    win.setFullScreen(false);
    win.setContentSize(Math.round(w), Math.round(h));
    win.center();
  });
  ipcMain.handle('app:quit', () => app.quit());
  ipcMain.handle('app:savesPath', () => savesDir());
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1024,
    minHeight: 600,
    backgroundColor: '#10141c',
    title: 'BusinessSim',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win?.show());
  win.on('closed', () => (win = null));

  // The game never navigates or opens windows.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') win?.setFullScreen(!win.isFullScreen());
    if (input.key === 'F12' && !app.isPackaged) win?.webContents.toggleDevTools();
  });

  if (DEV_URL && !app.isPackaged) void win.loadURL(DEV_URL);
  else void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  void app.whenReady().then(() => {
    registerIpc();
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
