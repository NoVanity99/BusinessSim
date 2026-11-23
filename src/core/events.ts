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
  'car:removed': number;
  'npc:selected': number | null;
  /** A customer paid. Tile coordinates of the checkout for effects. */
  sale: { shopId: number; amount: number; x: number; y: number };
  'door:enter': { shopId: number };
  /** A floating message at a world position (tile coordinates). */
  'world:bubble': { x: number; y: number; text: string; kind: 'good' | 'bad' | 'neutral' };
  'visit:ended': { shopId: number; mood: number; bought: boolean };
  'staff:changed': void;
  'level:up': number;
  'xp:changed': void;
  'upgrades:changed': void;
  'loans:changed': void;
  'news:changed': void;
  'game:won': void;
  'game:over': void;
  'overlay:changed': string | null;
  'weather:changed': string;
  'review:posted': { shopId: number; stars: number; text: string };
  'regular:gained': { shopId: number; name: string };
  'quality:changed': string;
  /** Something visual happened at a tile: dust when building, sparkles at a till. */
  fx: { kind: 'dust' | 'coins' | 'steam' | 'smoke' | 'splash'; x: number; y: number };
  'staff:removed': number;
  /** A guard got hold of a fleeing shoplifter. */
  'thief:caught': { customerId: number; by: number };
  'rivals:changed': void;
  /** Centre the camera on a lot. */
  'camera:focus': number;
  /** Centre the camera on a tile position. */
  'camera:pan': { x: number; y: number };
  'notes:changed': void;
  achievement: string;
  'marketing:changed': void;
  'logistics:changed': void;
  'finance:changed': void;
  'player:changed': void;
  /** One of your vans has set off with a delivery. */
  'delivery:sent': { fromShopId: number; toShopId: number };
  'season:changed': string;
  /** Add to a lifetime counter. */
  stat: { stat: string; by?: number };
  /** Show the help window. */
  'help:open': void;
  /** A shop's undo history changed. Payload: shop id. */
  'build:history': number;
  'minimap:toggle': void;
  /** Open one of the sidebar windows, optionally on a particular shop. */
  'window:open': { id: string; shopId?: number };
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
