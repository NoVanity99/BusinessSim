export type UpdateStatus = 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'uptodate' | 'error';

/** Mirrors UpdateState in electron/updater.ts. */
export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  reason?: string;
  version?: string;
  notes?: string;
  percent?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  error?: string;
  portable: boolean;
  autoDownload: boolean;
  lastChecked?: number;
}

export interface UpdaterApi {
  getState(): Promise<UpdateState>;
  start(): Promise<void>;
  check(): Promise<void>;
  download(): Promise<void>;
  install(): Promise<void>;
  setAutoDownload(on: boolean): Promise<void>;
  openReleases(): Promise<void>;
  onState(cb: (state: UpdateState) => void): () => void;
}

/** Bridge exposed by electron/preload.ts. Undefined when running in a plain browser. */
export interface PlatformApi {
  isElectron: boolean;
  storage: {
    read(key: string): Promise<string | null>;
    write(key: string, data: string): Promise<void>;
    remove(key: string): Promise<void>;
    list(): Promise<string[]>;
  };
  window: {
    setFullscreen(on: boolean): Promise<void>;
    isFullscreen(): Promise<boolean>;
    setSize(w: number, h: number): Promise<void>;
  };
  /** Missing in the browser and in older desktop builds. */
  updater?: UpdaterApi;
  quit(): Promise<void>;
  savesPath(): Promise<string>;
}

declare global {
  interface Window {
    api?: PlatformApi;
  }
  const __APP_VERSION__: string;
}

export const platform: PlatformApi | undefined = window.api;
export const isElectron = !!platform?.isElectron;
export const APP_VERSION = __APP_VERSION__;
