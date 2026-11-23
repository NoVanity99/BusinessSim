import { bus, toast } from '../../core/events';
import { session, type GameState } from '../../core/state';
import achievementsJson from '../../data/achievements.json';
import { regularsOf } from '../ai/residents';
import { netWorth } from '../economy/networth';
import { companyValue } from '../rivals/rivals';
import { dayOf } from '../time/clock';
import { addXp } from './level';

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  stat: string;
  at: number;
  xp: number;
}

export const ACHIEVEMENTS = (achievementsJson as unknown as { list: AchievementDef[] }).list;

/** Lifetime counters shown on the statistics page, with their labels. */
export const STAT_LABELS: Record<string, string> = {
  served: 'Customers served',
  revenue: 'Total takings',
  shopsOpened: 'Businesses opened',
  fiveStars: 'Five-star reviews',
  oneStars: 'One-star reviews',
  thieves: 'Shoplifters caught',
  buyouts: 'Rival shops bought out',
  loansRepaid: 'Loans paid off',
  built: 'Things built',
  franchises: 'Franchises opened',
};

const bump = (s: GameState, stat: string, by = 1): void => {
  s.stats[stat] = (s.stats[stat] ?? 0) + by;
};

/** The current value of a stat: a lifetime counter, or a figure worked out from the game as it stands. */
export function statValue(s: GameState, stat: string): number {
  switch (stat) {
    case 'shops':
      return s.shops.length;
    case 'shopTypes':
      return new Set(s.shops.map((sh) => sh.type)).size;
    case 'staff':
      return s.staff.length;
    case 'regulars':
      return s.shops.reduce((a, sh) => a + regularsOf(s, sh.id), 0);
    case 'netWorth':
      return netWorth(s, session.city);
    case 'day':
      return dayOf(s.time);
    case 'level':
      return s.level;
    case 'leading':
      return dayOf(s.time) > 7 && s.shops.length > 0 && s.rivals.every((c) => companyValue(c) < netWorth(s, session.city)) ? 1 : 0;
    default:
      return s.stats[stat] ?? 0;
  }
}

/** Unlock anything whose target has been reached. */
export function checkAchievements(s: GameState): void {
  for (const a of ACHIEVEMENTS) {
    if (s.achievements[a.id] || statValue(s, a.stat) < a.at) continue;
    s.achievements[a.id] = dayOf(s.time);
    toast(`Achievement unlocked: ${a.name}. ${a.description}`, 'good');
    if (a.xp) addXp(s, a.xp);
    bus.emit('achievement', a.id);
  }
}

/** Count the things achievements and the statistics page are built on. Returns a cleanup function. */
export function installAchievements(s: GameState): () => void {
  const offs = [
    bus.on('visit:ended', ({ bought }) => bought && bump(s, 'served')),
    bus.on('sale', ({ amount }) => bump(s, 'revenue', amount)),
    bus.on('shop:created', () => bump(s, 'shopsOpened')),
    bus.on('review:posted', ({ stars }) => (stars === 5 ? bump(s, 'fiveStars') : stars === 1 ? bump(s, 'oneStars') : undefined)),
    bus.on('thief:caught', () => bump(s, 'thieves')),
    bus.on('stat', ({ stat, by }) => bump(s, stat, by ?? 1)),
    bus.on('time:hour', () => checkAchievements(s)),
  ];
  return () => offs.forEach((off) => off());
}
