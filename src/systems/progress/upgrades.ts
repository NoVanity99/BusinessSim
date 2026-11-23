import { bus, toast } from '../../core/events';
import { money } from '../../core/format';
import type { GameState } from '../../core/state';
import { SHOP_TYPES, UPGRADES, type UpgradeDef } from '../../data';
import type { ShopState } from '../../entities/Shop';
import { tryPay } from '../economy/finance';

/** Company-wide upgrades are stored under this pseudo shop id. */
export const COMPANY = 0;

export const upgradeLevel = (s: GameState, shopId: number, id: string): number => s.upgrades[shopId]?.[id] ?? 0;

/** Each level costs more than the last. */
export const upgradeCost = (def: UpgradeDef, currentLevel: number): number => Math.round(def.cost * Math.pow(1.6, currentLevel));

export function upgradesFor(shop: ShopState | null): [string, UpgradeDef][] {
  return Object.entries(UPGRADES).filter(([, d]) => (shop ? !d.company && d.flows?.includes(SHOP_TYPES[shop.type].flow) : d.company));
}

export function buyUpgrade(s: GameState, shopId: number, id: string): boolean {
  const def = UPGRADES[id];
  const level = upgradeLevel(s, shopId, id);
  if (level >= def.maxLevel || s.level < def.unlockLevel) return false;
  const cost = upgradeCost(def, level);
  if (!tryPay(s, cost, 'construction')) {
    toast(`You need ${money(cost)} for ${def.name}.`, 'bad');
    return false;
  }
  (s.upgrades[shopId] ??= {})[id] = level + 1;
  if (id === 'bigBackroom') {
    const shop = s.shops.find((sh) => sh.id === shopId);
    if (shop) shop.storageBonus = (level + 1) * 150;
  }
  toast(`${def.name} installed.`, 'good');
  bus.emit('upgrades:changed');
  if (shopId !== COMPANY) bus.emit('shop:changed', shopId);
  return true;
}
