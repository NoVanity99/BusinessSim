import { bus, toast } from '../../core/events';
import { money } from '../../core/format';
import type { GameState } from '../../core/state';
import { DIFFICULTIES, EVENTS, type LoanOffer } from '../../data';
import { dayOf } from '../time/clock';
import { earn, spend, tryPay } from './finance';

export interface Loan {
  id: number;
  name: string;
  principal: number;
  /** Still owed. */
  balance: number;
  dailyRate: number;
  /** Capital repaid each day. */
  dailyCapital: number;
  takenDay: number;
}

export const loanRate = (s: GameState, offer: LoanOffer): number => offer.dailyRate * DIFFICULTIES[s.difficulty].loanInterestMult;
export const totalDebt = (s: GameState): number => s.loans.reduce((a, l) => a + l.balance, 0);
export const dailyLoanCost = (s: GameState): number => s.loans.reduce((a, l) => a + Math.min(l.balance, l.dailyCapital) + l.balance * l.dailyRate, 0);

export function canTakeLoan(s: GameState, offer: LoanOffer): string | null {
  if (s.level < offer.unlockLevel) return `Needs level ${offer.unlockLevel}`;
  if (s.loans.length >= EVENTS.maxLoans) return 'You already have the maximum number of loans';
  if (s.loans.some((l) => l.name === offer.name)) return 'You already have this loan';
  return null;
}

export function takeLoan(s: GameState, offer: LoanOffer): boolean {
  if (canTakeLoan(s, offer)) return false;
  s.loans.push({ id: s.nextLoanId++, name: offer.name, principal: offer.amount, balance: offer.amount, dailyRate: loanRate(s, offer), dailyCapital: offer.amount / offer.days, takenDay: dayOf(s.time) });
  earn(s, offer.amount, 'loan');
  toast(`${offer.name} of ${money(offer.amount)} paid into your account.`, 'good');
  bus.emit('loans:changed');
  return true;
}

/** Pay off part or all of a loan early. */
export function repayLoan(s: GameState, loanId: number, amount: number): boolean {
  const loan = s.loans.find((l) => l.id === loanId);
  if (!loan) return false;
  amount = Math.min(amount, loan.balance);
  if (!tryPay(s, amount, 'loanPayment')) {
    toast('Not enough cash for that repayment.', 'bad');
    return false;
  }
  loan.balance -= amount;
  if (loan.balance < 0.5) {
    s.loans.splice(s.loans.indexOf(loan), 1);
    bus.emit('stat', { stat: 'loansRepaid' });
    toast(`${loan.name} paid off.`, 'good');
  }
  bus.emit('loans:changed');
  return true;
}

/** Midnight: interest and scheduled capital on every loan, plus overdraft interest on negative cash. */
export function loansDaily(s: GameState): void {
  for (const loan of [...s.loans]) {
    const interest = loan.balance * loan.dailyRate;
    const capital = Math.min(loan.balance, loan.dailyCapital);
    spend(s, interest, 'interest');
    spend(s, capital, 'loanPayment');
    loan.balance -= capital;
    if (loan.balance < 0.5) {
      s.loans.splice(s.loans.indexOf(loan), 1);
      bus.emit('stat', { stat: 'loansRepaid' });
      toast(`${loan.name} paid off.`, 'good');
    }
  }
  if (s.money < 0) {
    const fee = -s.money * EVENTS.overdraftDailyRate;
    spend(s, fee, 'interest');
    toast(`You are overdrawn. The bank charged ${money(Math.round(fee))} in overdraft interest.`, 'warn');
  }
  bus.emit('loans:changed');
}
