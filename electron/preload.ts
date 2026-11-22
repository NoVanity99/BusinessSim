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
  quit: (): Promise<void> => ipcRenderer.invoke('app:quit'),
  savesPath: (): Promise<string> => ipcRenderer.invoke('app:savesPath'),
});
