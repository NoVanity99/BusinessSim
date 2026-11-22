import { bus, toast } from '../../core/events';
import { money } from '../../core/format';
import type { GameState } from '../../core/state';
import { DIFFICULTIES } from '../../data';
import type { City, LotDef } from '../city/generate';
import { earn, spend, tryPay } from './finance';

/** Deposit when signing a lease, in days of rent. Returned when the lease ends. */
export const DEPOSIT_DAYS = 3;
/** Share of the purchase price you get back when selling a lot. */
export const RESALE_SHARE = 0.85;

export const rentOf = (s: GameState, lot: LotDef): number =>
  Math.round(lot.rent * DIFFICULTIES[s.difficulty].costMult);
export const priceOf = (s: GameState, lot: LotDef): number =>
  Math.round((lot.price * DIFFICULTIES[s.difficulty].costMult) / 100) * 100;
export const depositOf = (s: GameState, lot: LotDef): number => rentOf(s, lot) * DEPOSIT_DAYS;

export function rentLot(s: GameState, lot: LotDef): boolean {
  if (!lot.rentable || s.lots[lot.id]) return false;
  const deposit = depositOf(s, lot);
  if (!tryPay(s, deposit, 'deposit')) {
    toast(`You need ${money(deposit)} for the deposit.`, 'bad');
    return false;
  }
  s.lots[lot.id] = { owner: 'rented', deposit };
  toast(`Lease signed. Rent is ${money(rentOf(s, lot))} per day, charged at midnight.`, 'good');
  bus.emit('lot:changed', lot.id);
  return true;
}

export function buyLot(s: GameState, lot: LotDef): boolean {
  const current = s.lots[lot.id];
  if (!lot.rentable || current?.owner === 'owned') return false;
  const price = priceOf(s, lot);
  if (!tryPay(s, price, 'property')) {
    toast(`You need ${money(price)} to buy this lot.`, 'bad');
    return false;
  }
  if (current?.owner === 'rented') earn(s, current.deposit, 'refund');
  s.lots[lot.id] = { owner: 'owned', deposit: 0, paid: price };
  toast('Lot purchased. No more rent here.', 'good');
  bus.emit('lot:changed', lot.id);
  return true;
}

/** End a lease (deposit refunded) or sell an owned lot. */
export function releaseLot(s: GameState, lot: LotDef): boolean {
  const current = s.lots[lot.id];
  if (!current) return false;
  if (current.owner === 'rented') {
    earn(s, current.deposit, 'refund');
    toast(`Lease ended. Deposit of ${money(current.deposit)} returned.`, 'info');
  } else {
    const value = Math.round((current.paid ?? priceOf(s, lot)) * RESALE_SHARE);
    earn(s, value, 'propertySale');
    toast(`Lot sold for ${money(value)}.`, 'info');
  }
  delete s.lots[lot.id];
  bus.emit('lot:changed', lot.id);
  return true;
}

/** Charged at midnight for every rented lot. Returns the total. */
export function chargeDailyRent(s: GameState, city: City): number {
  let total = 0;
  for (const id of Object.keys(s.lots)) {
    if (s.lots[+id].owner === 'rented') total += rentOf(s, city.lots[+id]);
  }
  spend(s, total, 'rent');
  return total;
}
