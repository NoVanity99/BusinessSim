import { bus, toast } from '../../core/events';
import type { GameState } from '../../core/state';
import { EVENTS, SHOP_TYPES } from '../../data';

const XP = EVENTS.xp;
export const MAX_LEVEL = 12;

/** Total XP needed to reach a level. Level 1 needs none. */
export const xpForLevel = (level: number): number => (level <= 1 ? 0 : Math.round(XP.base * Math.pow(level - 1, XP.power)));

/** Progress through the current level, 0-1. */
export function levelProgress(s: GameState): number {
  if (s.level >= MAX_LEVEL) return 1;
  const from = xpForLevel(s.level);
  return (s.xp - from) / (xpForLevel(s.level + 1) - from);
}

export function addXp(s: GameState, amount: number): void {
  if (amount <= 0) return;
  s.xp += amount;
  while (s.level < MAX_LEVEL && s.xp >= xpForLevel(s.level + 1)) {
    s.level++;
    const unlocked = Object.values(SHOP_TYPES).filter((t) => t.unlockLevel === s.level).map((t) => t.name);
    toast(`Level ${s.level}!${unlocked.length ? ` You can now open: ${unlocked.join(', ')}.` : ' New upgrades and loans may be available.'}`, 'good');
    bus.emit('level:up', s.level);
  }
  bus.emit('xp:changed');
}

export const isUnlocked = (s: GameState, typeId: string): boolean => s.level >= SHOP_TYPES[typeId].unlockLevel;

/** Hook XP to the things that earn it. Returns a cleanup function. */
export function installProgress(s: GameState): () => void {
  const offs = [
    bus.on('visit:ended', ({ bought }) => bought && addXp(s, XP.perCustomer)),
    bus.on('sale', ({ amount }) => addXp(s, amount * XP.perRevenueDollar)),
    bus.on('shop:created', () => addXp(s, XP.perShopOpened)),
    bus.on('time:day', () => addXp(s, XP.perDay)),
  ];
  return () => offs.forEach((off) => off());
}
