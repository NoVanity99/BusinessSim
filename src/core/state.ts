import { SAVE_VERSION } from './constants';
import { DIFFICULTIES } from '../data';
import { newFinanceState, type FinanceState } from '../systems/economy/finance';
import { dayOf, newTimeState, type TimeState } from '../systems/time/clock';
import type { City } from '../systems/city/generate';

export interface LotOwnership {
  owner: 'rented' | 'owned';
  deposit: number;
  /** Purchase price paid, for resale value. */
  paid?: number;
}

/** Everything that gets saved. Plain JSON only: no classes, no Phaser objects. */
export interface GameState {
  version: number;
  companyName: string;
  difficulty: string;
  money: number;
  time: TimeState;
  /** Player-held lots keyed by lot id. */
  lots: Record<number, LotOwnership>;
  finance: FinanceState;
}

export interface NewGameOptions {
  companyName: string;
  difficulty: string;
}

export function createNewGame(opts: NewGameOptions): GameState {
  const time = newTimeState();
  return {
    version: SAVE_VERSION,
    companyName: opts.companyName.trim() || 'My Company',
    difficulty: opts.difficulty,
    money: DIFFICULTIES[opts.difficulty].startingMoney,
    time,
    lots: {},
    finance: newFinanceState(dayOf(time)),
  };
}

/** The running game. Set when a game starts or loads; cleared on return to menu. */
export const session: { state: GameState; city: City } = {
  state: undefined as unknown as GameState,
  city: undefined as unknown as City,
};
