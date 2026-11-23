import { contextBridge, ipcRenderer } from 'electron';

/** The only surface the game can reach in the main process. Mirrors src/core/platform.ts. */
contextBridge.exposeInMainWorld('api', {
  isElectron: true,
  storage: {
    read: (key: string): Promise<string | null> => ipcRenderer.invoke('storage:read', key),
    write: (key: string, data: string): Promise<void> => ipcRenderer.invoke('storage:write', key, data),
    remove: (key: string): Promise<void> => ipcRenderer.invoke('storage:remove', key),
    list: (): Promise<string[]> => ipcRenderer.invoke('storage:list'),
  },
  window: {
    setFullscreen: (on: boolean): Promise<void> => ipcRenderer.invoke('window:setFullscreen', on),
    isFullscreen: (): Promise<boolean> => ipcRenderer.invoke('window:isFullscreen'),
    setSize: (w: number, h: number): Promise<void> => ipcRenderer.invoke('window:setSize', w, h),
  },
  updater: {
    getState: (): Promise<unknown> => ipcRenderer.invoke('updater:getState'),
    start: (): Promise<void> => ipcRenderer.invoke('updater:start'),
    check: (): Promise<void> => ipcRenderer.invoke('updater:check'),
    download: (): Promise<void> => ipcRenderer.invoke('updater:download'),
    install: (): Promise<void> => ipcRenderer.invoke('updater:install'),
    setAutoDownload: (on: boolean): Promise<void> => ipcRenderer.invoke('updater:setAutoDownload', !!on),
    openReleases: (): Promise<void> => ipcRenderer.invoke('updater:openReleases'),
    /** Subscribe to state changes. Returns an unsubscribe function. */
    onState: (cb: (state: unknown) => void): (() => void) => {
      const listener = (_e: unknown, state: unknown): void => cb(state);
      ipcRenderer.on('updater:state', listener);
      return () => ipcRenderer.removeListener('updater:state', listener);
    },
  },
  quit: (): Promise<void> => ipcRenderer.invoke('app:quit'),
  savesPath: (): Promise<string> => ipcRenderer.invoke('app:savesPath'),
});
