/** Game-wide events. Systems emit, UI and scenes listen. */
export interface GameEvents {
  'money:changed': number;
  'time:minute': number;
  'time:hour': number;
  'time:day': number;
  'time:speed': number;
  'lot:changed': number;
  'lot:selected': number | null;
  toast: { text: string; kind?: 'info' | 'good' | 'warn' | 'bad' };
  'game:loaded': void;
}

type Handler<T> = (payload: T) => void;

class EventBus {
  private handlers = new Map<string, Set<Handler<never>>>();

  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => set.delete(fn as Handler<never>);
  }

  emit<K extends keyof GameEvents>(type: K, ...payload: GameEvents[K] extends void ? [] : [GameEvents[K]]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) (fn as Handler<unknown>)(payload[0]);
  }

  /** Drop every listener (used when leaving a game session). */
  clear(): void {
    this.handlers.clear();
  }
}

export const bus = new EventBus();

export function toast(text: string, kind: 'info' | 'good' | 'warn' | 'bad' = 'info'): void {
  bus.emit('toast', { text, kind });
}
