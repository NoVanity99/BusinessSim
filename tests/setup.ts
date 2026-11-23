// The game logic runs without a browser in these tests. A few modules touch `window`
// and `localStorage` at import time, so provide the minimum they need.
const store = new Map<string, string>();
const localStorageStub = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  key: (i: number) => [...store.keys()][i] ?? null,
  clear: () => store.clear(),
  get length() {
    return store.size;
  },
};

Object.assign(globalThis, { window: globalThis, localStorage: localStorageStub });
