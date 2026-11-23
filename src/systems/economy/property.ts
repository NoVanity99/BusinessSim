import { bus, toast } from '../../core/events';
import { money } from '../../core/format';
import type { GameState } from '../../core/state';
import { CORPORATE, DIFFICULTIES } from '../../data';
import { rand } from '../../core/rng';
import { dayOf } from '../time/clock';
import { shopOnLot } from '../../core/state';
import type { City, LotDef } from '../city/generate';
import { earn, spend, tryPay } from './finance';
import { occupantOf } from '../rivals/rivals';

/** Deposit when signing a lease, in days of rent. Returned when the lease ends. */
export const DEPOSIT_DAYS = 3;
/** Share of the purchase price you get back when selling a lot. */
export const RESALE_SHARE = 0.85;

/** The district's price level against where it started. */
const index = (s: GameState, lot: LotDef): number => s.propertyIndex?.[lot.district] ?? 1;

export const rentOf = (s: GameState, lot: LotDef): number =>
  Math.round((lot.rent * DIFFICULTIES[s.difficulty].costMult * index(s, lot)) / 5) * 5;
export const priceOf = (s: GameState, lot: LotDef): number =>
  Math.round((lot.price * DIFFICULTIES[s.difficulty].costMult * index(s, lot)) / 100) * 100;
/** What an owned lot would fetch today, after the agent's fee. */
export const saleValue = (s: GameState, lot: LotDef): number => Math.round(priceOf(s, lot) * (1 - CORPORATE.property.saleFee));
export const depositOf = (s: GameState, lot: LotDef): number => rentOf(s, lot) * DEPOSIT_DAYS;

export function rentLot(s: GameState, lot: LotDef): boolean {
  if (!lot.rentable || s.lots[lot.id] || occupantOf(s, lot.id)) return false;
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
  if (!lot.rentable || current?.owner === 'owned' || occupantOf(s, lot.id)) return false;
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
    if (current.tenant) return false;
    const value = saleValue(s, lot);
    const gain = value - (current.paid ?? value);
    earn(s, value, 'propertySale');
    toast(`Lot sold for ${money(value)}${Math.abs(gain) >= 100 ? `, ${gain > 0 ? 'a profit' : 'a loss'} of ${money(Math.abs(gain))} on what you paid` : ''}.`, gain >= 0 ? 'good' : 'info');
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

/** What a tenant would pay per day for a lot at today's prices. */
export const tenantRent = (s: GameState, lot: LotDef): number => Math.round(lot.rent * index(s, lot) * CORPORATE.property.tenantRentShare);

/** Let an owned, empty lot to a tenant. They pay rent every morning and their premises occupy the lot. */
export function letLot(s: GameState, lot: LotDef): boolean {
  const own = s.lots[lot.id];
  if (own?.owner !== 'owned' || own.tenant || shopOnLot(s, lot.id)) return false;
  own.tenant = { name: rand.pick(CORPORATE.property.tenantNames), rent: tenantRent(s, lot), sinceDay: dayOf(s.time) };
  toast(`Lot let to a ${own.tenant.name.toLowerCase()} for ${money(own.tenant.rent)} a day.`, 'good');
  bus.emit('lot:changed', lot.id);
  bus.emit('rivals:changed');
  return true;
}

export const evictFee = (s: GameState, lot: LotDef): number => (s.lots[lot.id]?.tenant?.rent ?? 0) * CORPORATE.property.evictFeeDays;

/** End a tenancy early, paying the tenant off. */
export function evictTenant(s: GameState, lot: LotDef): boolean {
  const own = s.lots[lot.id];
  if (!own?.tenant) return false;
  const fee = evictFee(s, lot);
  if (!tryPay(s, fee, 'other')) {
    toast(`You need ${money(fee)} to buy the tenant out of their lease.`, 'bad');
    return false;
  }
  delete own.tenant;
  bus.emit('lot:changed', lot.id);
  bus.emit('rivals:changed');
  return true;
}
