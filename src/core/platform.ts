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
