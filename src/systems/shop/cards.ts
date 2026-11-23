import { bus, toast } from '../../core/events';
import { money } from '../../core/format';
import { rand } from '../../core/rng';
import type { GameState } from '../../core/state';
import type { ShopState } from '../../entities/Shop';
import { tryPay } from '../economy/finance';
import { marketPrice } from '../economy/market';
import { addToStorage, takeFromStorage } from '../economy/stock';
import { dayOf } from '../time/clock';

/** Odds per booster pack. Edit to rebalance the gamble. */
export const PACK_ODDS = { commons: 4, rareChance: 0.3, ultraChance: 0.03 };
export const TOURNAMENT_COST = 150;

/**
 * Crack sealed packs from the back room into single cards.
 * Singles are worth more in total on average, but sell slower and their prices swing.
 */
export function openPacks(s: GameState, shop: ShopState, count: number): void {
  const n = takeFromStorage(shop, 'booster', count);
  if (!n) return;
  let rare = 0;
  let ultra = 0;
  for (let i = 0; i < n; i++) {
    if (rand.chance(PACK_ODDS.rareChance)) rare++;
    if (rand.chance(PACK_ODDS.ultraChance)) ultra++;
  }
  addToStorage(shop, 'single_common', n * PACK_ODDS.commons, 0);
  addToStorage(shop, 'single_rare', rare, 0);
  addToStorage(shop, 'single_ultra', ultra, 0);
  const value = n * PACK_ODDS.commons * marketPrice(s, 'single_common') + rare * marketPrice(s, 'single_rare') + ultra * marketPrice(s, 'single_ultra');
  toast(`Opened ${n} pack${n === 1 ? '' : 's'}: ${rare} rare, ${ultra} ultra rare. About ${money(Math.round(value))} of singles.`, ultra ? 'good' : 'info');
  bus.emit('stock:changed', shop.id);
}

/** Book a tournament for tomorrow: players flood in and pay an entry fee at the tables. */
export function scheduleTournament(s: GameState, shop: ShopState): boolean {
  if (!tryPay(s, TOURNAMENT_COST, 'marketing')) {
    toast(`You need ${money(TOURNAMENT_COST)} for prizes and promotion.`, 'bad');
    return false;
  }
  shop.eventDay = dayOf(s.time) + 1;
  shop.today.costs += TOURNAMENT_COST;
  toast(`Tournament at ${shop.name} tomorrow. Stock up on packs and make sure there are tables.`, 'good');
  bus.emit('shop:changed', shop.id);
  return true;
}
