import type { Tool } from './uiState';

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
  /** Layout changed (walls, floors, furniture, hours, name). Payload: shop id. */
  'shop:changed': number;
  'shop:created': number;
  'shop:removed': number;
  /** Shelf or storage quantities changed. Payload: shop id. */
  'stock:changed': number;
  'orders:changed': void;
  'prices:changed': number;
  'market:changed': void;
  'tool:changed': Tool | null;
  'npc:thought': { id: number; text: string; kind: 'good' | 'bad' | 'neutral' };
  'npc:removed': number;
  'npc:selected': number | null;
  /** A customer paid. Tile coordinates of the checkout for effects. */
  sale: { shopId: number; amount: number; x: number; y: number };
  'door:enter': { shopId: number };
  'staff:changed': void;
  'staff:removed': number;
  'staff:selected': number | null;
  'object:selected': { shopId: number; objectId: number } | null;
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
