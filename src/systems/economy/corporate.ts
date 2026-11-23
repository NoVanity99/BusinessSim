import { bus, toast } from '../../core/events';
import { clamp, money } from '../../core/format';
import { rand } from '../../core/rng';
import { session, type GameState } from '../../core/state';
import { CORPORATE as C, NEIGHBORHOODS } from '../../data';
import { companyValue } from '../rivals/rivals';
import { dayOf } from '../time/clock';
import { earn, spend, sum, tryPay, type DayLedger } from './finance';
import { netWorth } from './networth';

/**
 * The company as a financial thing: the property market, tenants, investors, tax,
 * insurance and how its worth compares with the rivals' over time.
 */

// ---------- Property market ----------

/** Where prices stand in a district against their starting level. */
export const propertyIndex = (s: GameState, district: string): number => s.propertyIndex[district] ?? 1;

/** Prices drift a little every day, pulled back toward normal and lifted by busy, well-run streets. */
export function propertyDaily(s: GameState): void {
  const P = C.property;
  for (const district of Object.keys(NEIGHBORHOODS)) {
    const lots = session.city.lots.filter((l) => l.district === district && l.rentable);
    // Shops doing well make an area more desirable.
    const thriving = s.shops.filter((sh) => session.city.lots[sh.lotId].district === district && sh.reputation > 55).length + s.rivals.reduce((a, c) => a + c.shops.filter((sh) => session.city.lots[sh.lotId].district === district).length, 0) * 0.5;
    const cur = propertyIndex(s, district);
    const next = cur * (1 + rand.range(-P.driftPerDay, P.driftPerDay) + (1 - cur) * P.reversion + Math.min(0.012, (thriving / Math.max(1, lots.length)) * P.shopBoost * 10));
    s.propertyIndex[district] = clamp(next, P.minIndex, P.maxIndex);
  }
  (s.propertyHistory ??= []).push({ day: dayOf(s.time), index: { ...s.propertyIndex } });
  if (s.propertyHistory.length > 60) s.propertyHistory.shift();
}

/** Rent you receive from tenants, paid every morning. */
export function tenantsDaily(s: GameState): number {
  let total = 0;
  for (const [id, own] of Object.entries(s.lots)) {
    if (!own.tenant) continue;
    // Rents follow the market.
    own.tenant.rent = Math.round(session.city.lots[+id].rent * propertyIndex(s, session.city.lots[+id].district) * C.property.tenantRentShare);
    total += own.tenant.rent;
  }
  earn(s, total, 'rentIncome');
  return total;
}

// ---------- Investors ----------

export interface Investor {
  name: string;
  /** Share of the company they own, 0-1. */
  stake: number;
  paid: number;
  sinceDay: number;
}

export interface InvestorOffer {
  id: number;
  name: string;
  stake: number;
  amount: number;
  untilDay: number;
}

/** What the company is judged to be worth by people putting money in. */
export const valuation = (s: GameState): number => Math.max(5000, netWorth(s, session.city) * C.investors.valuationMultiple);
export const totalStake = (s: GameState): number => s.investors.reduce((a, i) => a + i.stake, 0);
export const buybackPrice = (s: GameState, inv: Investor): number => Math.round((Math.max(inv.paid, valuation(s) * inv.stake) * C.investors.buybackPremium) / 100) * 100;

function maybeInvestorOffer(s: GameState): void {
  const I = C.investors;
  const day = dayOf(s.time);
  if (s.level < I.minLevel || s.investorOffers.length || !s.shops.length || !rand.chance(I.offerChance)) return;
  const stakes = I.stakes.filter((st) => totalStake(s) + st <= I.maxTotalStake);
  const free = I.names.filter((n) => !s.investors.some((i) => i.name === n));
  if (!stakes.length || !free.length) return;
  const stake = rand.pick(stakes);
  const offer: InvestorOffer = { id: s.nextOfferId++, name: rand.pick(free), stake, amount: Math.round((valuation(s) * stake * rand.range(0.85, 1.1)) / 100) * 100, untilDay: day + I.offerDays };
  s.investorOffers.push(offer);
  toast(`${offer.name} is offering ${money(offer.amount)} for ${Math.round(stake * 100)}% of the company. See Finances.`, 'info');
}

export function acceptInvestor(s: GameState, id: number): boolean {
  const o = s.investorOffers.find((x) => x.id === id);
  if (!o || totalStake(s) + o.stake > C.investors.maxTotalStake + 1e-9) return false;
  s.investorOffers.splice(s.investorOffers.indexOf(o), 1);
  s.investors.push({ name: o.name, stake: o.stake, paid: o.amount, sinceDay: dayOf(s.time) });
  earn(s, o.amount, 'investment');
  toast(`${o.name} now owns ${Math.round(o.stake * 100)}% of the company and takes that share of each day's profit.`, 'good');
  bus.emit('finance:changed');
  return true;
}

export function declineInvestor(s: GameState, id: number): void {
  s.investorOffers = s.investorOffers.filter((x) => x.id !== id);
  bus.emit('finance:changed');
}

export function buyBack(s: GameState, inv: Investor): boolean {
  const price = buybackPrice(s, inv);
  if (!tryPay(s, price, 'buyback')) {
    toast(`You need ${money(price)} to buy ${inv.name} out.`, 'bad');
    return false;
  }
  s.investors.splice(s.investors.indexOf(inv), 1);
  toast(`You bought back ${inv.name}'s ${Math.round(inv.stake * 100)}% for ${money(price)}.`, 'good');
  bus.emit('finance:changed');
  return true;
}

// ---------- Tax ----------

/** Profit that counts for tax: trading income less running costs, leaving out loans, property deals and the like. */
export function taxableProfit(ledgers: DayLedger[]): number {
  const T = C.tax;
  let profit = 0;
  for (const l of ledgers) {
    for (const [k, v] of Object.entries(l.income)) if (!T.exemptIncome.includes(k)) profit += v ?? 0;
    for (const [k, v] of Object.entries(l.expense)) if (!T.exemptExpense.includes(k)) profit -= v ?? 0;
  }
  return profit;
}

/** Value of the lots the company owns, at today's prices. */
export const ownedPropertyValue = (s: GameState): number =>
  Object.entries(s.lots).reduce((a, [id, own]) => a + (own.owner === 'owned' ? session.city.lots[+id].price * propertyIndex(s, session.city.lots[+id].district) : 0), 0);

export const daysToTax = (s: GameState): number => C.tax.everyDays - ((dayOf(s.time) - 1) % C.tax.everyDays);

/** The bill that will fall due at the end of the current tax week, as things stand. */
export function taxForecast(s: GameState): { profit: number; profitTax: number; propertyTax: number; total: number } {
  const T = C.tax;
  const since = dayOf(s.time) - ((dayOf(s.time) - 1) % T.everyDays);
  const ledgers = [...s.finance.history.filter((l) => l.day >= since), s.finance.today];
  const profit = taxableProfit(ledgers);
  const profitTax = Math.max(0, profit) * T.profitRate;
  const propertyTax = ownedPropertyValue(s) * T.propertyRatePerDay * T.everyDays;
  return { profit, profitTax, propertyTax, total: Math.round(profitTax + propertyTax) };
}

/** Called after a day's books are closed: on the last day of each tax week the bill is charged. */
function taxDaily(s: GameState, closedDay: number): void {
  const T = C.tax;
  if (closedDay % T.everyDays !== 0) return;
  const ledgers = s.finance.history.filter((l) => l.day > closedDay - T.everyDays && l.day <= closedDay);
  const bill = Math.round(Math.max(0, taxableProfit(ledgers)) * T.profitRate + ownedPropertyValue(s) * T.propertyRatePerDay * T.everyDays);
  if (bill <= 0) return;
  spend(s, bill, 'tax');
  toast(`Tax for the week: ${money(bill)} paid.${s.money < 0 ? ' It has pushed the account into the red.' : ''}`, s.money < 0 ? 'warn' : 'info');
}

// ---------- Insurance ----------

export type Policy = keyof typeof C.insurance;

export const insured = (s: GameState, policy: Policy): boolean => !!s.insurance[policy];
export const premiumPerDay = (s: GameState, policy: Policy): number => C.insurance[policy].perShopPerDay * Math.max(1, s.shops.length);

export function setInsurance(s: GameState, policy: Policy, on: boolean): void {
  s.insurance[policy] = on;
  if (on) toast(`${C.insurance[policy].name} taken out: ${money(premiumPerDay(s, policy))} a day.`, 'good');
  bus.emit('finance:changed');
}

/** Pay out on a loss if the policy is held. Returns what was paid. */
export function claim(s: GameState, policy: Policy, loss: number): number {
  if (!insured(s, policy) || loss <= 0) return 0;
  const paid = Math.round(loss * C.insurance[policy].covers * 100) / 100;
  earn(s, paid, 'insurance');
  return paid;
}

function insuranceDaily(s: GameState): void {
  let total = 0;
  for (const p of Object.keys(C.insurance) as Policy[]) if (insured(s, p)) total += premiumPerDay(s, p);
  spend(s, total, 'insurance');
}

// ---------- Company index ----------

/** Record today's worth of every company, for the chart. */
function indexDaily(s: GameState): void {
  const values: Record<string, number> = { [s.companyName]: Math.round(netWorth(s, session.city)) };
  for (const c of s.rivals) values[c.name] = companyValue(c);
  s.companyIndex.push({ day: dayOf(s.time), values });
  if (s.companyIndex.length > 60) s.companyIndex.shift();
}

// ---------- Daily ----------

/** Start-of-day pass for everything corporate. `closed` is the ledger of the day that just ended. */
export function corporateDaily(s: GameState, closed: DayLedger): void {
  const day = dayOf(s.time);
  propertyDaily(s);
  tenantsDaily(s);
  insuranceDaily(s);
  // Investors take their share of yesterday's trading profit.
  const profit = taxableProfit([closed]);
  if (profit > 0) {
    let paid = 0;
    for (const inv of s.investors) paid += profit * inv.stake;
    spend(s, Math.round(paid * 100) / 100, 'dividends');
  }
  taxDaily(s, closed.day);
  s.investorOffers = s.investorOffers.filter((o) => o.untilDay >= day);
  maybeInvestorOffer(s);
  indexDaily(s);
  bus.emit('finance:changed');
}

export const ledgerNet = (l: DayLedger): number => sum(l.income) - sum(l.expense);
