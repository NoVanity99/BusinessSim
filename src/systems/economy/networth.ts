import type { GameState } from '../../core/state';
import { PRODUCTS } from '../../data';
import { batchQty } from '../../entities/Shop';
import { sellValue } from '../build/build';
import type { City } from '../city/generate';
import { priceOf, RESALE_SHARE } from './property';

export interface NetWorthParts {
  cash: number;
  property: number;
  equipment: number;
  stock: number;
  deposits: number;
  debt: number;
}

/** Everything the company would be worth if it were wound up today. */
export function netWorthParts(s: GameState, city: City): NetWorthParts {
  const parts: NetWorthParts = { cash: s.money, property: 0, equipment: 0, stock: 0, deposits: 0, debt: 0 };
  for (const [id, own] of Object.entries(s.lots)) {
    if (own.owner === 'owned') parts.property += (own.paid ?? priceOf(s, city.lots[+id])) * RESALE_SHARE;
    else parts.deposits += own.deposit;
  }
  for (const shop of s.shops) {
    for (const o of shop.objects) {
      parts.equipment += sellValue(s, o.def);
      for (const slot of o.slots ?? []) if (slot.product) parts.stock += batchQty(slot.batches) * PRODUCTS[slot.product].wholesale;
    }
    for (const [p, batches] of Object.entries(shop.storage)) parts.stock += batchQty(batches) * PRODUCTS[p].wholesale;
  }
  parts.debt = s.loans.reduce((a, l) => a + l.balance, 0);
  return parts;
}

export function netWorth(s: GameState, city: City): number {
  const p = netWorthParts(s, city);
  return p.cash + p.property + p.equipment + p.stock + p.deposits - p.debt;
}
