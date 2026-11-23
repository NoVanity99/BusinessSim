import { bus } from '../../core/events';
import type { GameState } from '../../core/state';

export type IncomeCategory = 'sales' | 'services' | 'wholesale' | 'royalties' | 'propertySale' | 'loan' | 'refund' | 'other';
export type ExpenseCategory =
  | 'rent' | 'wages' | 'utilities' | 'stock' | 'construction' | 'property' | 'deposit'
  | 'loanPayment' | 'interest' | 'fines' | 'maintenance' | 'marketing' | 'licenses' | 'other';

export interface DayLedger {
  day: number;
  income: Partial<Record<IncomeCategory, number>>;
  expense: Partial<Record<ExpenseCategory, number>>;
}

export interface FinanceState {
  today: DayLedger;
  /** Closed days, oldest first (capped). */
  history: DayLedger[];
}

export const HISTORY_DAYS = 56;

export function newFinanceState(day: number): FinanceState {
  return { today: { day, income: {}, expense: {} }, history: [] };
}

export const sum = (rec: Partial<Record<string, number>>): number =>
  Object.values(rec).reduce<number>((a, b) => a + (b ?? 0), 0);

export function canAfford(s: GameState, amount: number): boolean {
  return s.money >= amount;
}

export function earn(s: GameState, amount: number, cat: IncomeCategory): void {
  if (amount <= 0) return;
  s.money += amount;
  s.finance.today.income[cat] = (s.finance.today.income[cat] ?? 0) + amount;
  bus.emit('money:changed', s.money);
}

/** Deducts money even if it goes negative (bills always get paid; debt has consequences later). */
export function spend(s: GameState, amount: number, cat: ExpenseCategory): void {
  if (amount <= 0) return;
  s.money -= amount;
  s.finance.today.expense[cat] = (s.finance.today.expense[cat] ?? 0) + amount;
  bus.emit('money:changed', s.money);
}

/** Spend only if affordable. Returns whether the purchase happened. */
export function tryPay(s: GameState, amount: number, cat: ExpenseCategory): boolean {
  if (!canAfford(s, amount)) return false;
  spend(s, amount, cat);
  return true;
}

/** Close the books for the day that just ended and open a new ledger. */
export function closeDay(s: GameState, newDay: number): DayLedger {
  const closed = s.finance.today;
  s.finance.history.push(closed);
  if (s.finance.history.length > HISTORY_DAYS) s.finance.history.shift();
  s.finance.today = { day: newDay, income: {}, expense: {} };
  return closed;
}
