import { SAVE_VERSION } from './constants';
import { DIFFICULTIES } from '../data';
import { newFinanceState, type FinanceState } from '../systems/economy/finance';
import { dayOf, newTimeState, type TimeState } from '../systems/time/clock';
import type { City } from '../systems/city/generate';
import type { ShopState } from '../entities/Shop';
import type { Candidate, Employee } from '../entities/Employee';
import { newMarketState, type MarketState } from '../systems/economy/market';
import type { Order } from '../systems/economy/stock';
import type { Loan } from '../systems/economy/loans';
import type { ActiveEvent, NewsItem } from '../systems/events/events';
import { newWeatherState, type WeatherState } from '../systems/world/weather';
import type { Resident } from '../systems/ai/residents';
import type { PoachOffer, RivalCompany } from '../systems/rivals/rivals';
import type { Campaign } from '../systems/marketing/marketing';
import type { Contract } from '../systems/logistics/logistics';
import type { Franchise, FranchiseOffer } from '../systems/logistics/franchise';

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
  shops: ShopState[];
  nextShopId: number;
  market: MarketState;
  orders: Order[];
  nextOrderId: number;
  /** Register the owner is personally working, if any. */
  ownerAt: { shopId: number; objectId: number } | null;
  staff: Employee[];
  candidates: Candidate[];
  nextPersonId: number;
  /** Purchased upgrade levels per shop id. */
  upgrades: Record<number, Record<string, number>>;
  xp: number;
  level: number;
  loans: Loan[];
  nextLoanId: number;
  events: ActiveEvent[];
  news: NewsItem[];
  /** The net-worth goal has been reached (the game carries on). */
  won: boolean;
  bankrupt: boolean;
  weather: WeatherState;
  /** Everyone who lives in the city. Filled in when the simulation first starts. */
  residents: Resident[];
  /** Competing companies and their shops. Created when the simulation first starts. */
  rivals: RivalCompany[];
  nextRivalShopId: number;
  /** Job offers rivals have made to the player's staff. */
  offers: PoachOffer[];
  /** Lifetime counters (customers served, takings, thieves caught...). */
  stats: Record<string, number>;
  /** Achievement id to the day it was unlocked. */
  achievements: Record<string, number>;
  /** Advertising campaigns that are running. */
  campaigns: Campaign[];
  /** Standing orders with suppliers. */
  contracts: Contract[];
  nextContractId: number;
  /** Shops other people run under your brands. */
  franchises: Franchise[];
  franchiseOffers: FranchiseOffer[];
  nextFranchiseId: number;
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
    shops: [],
    nextShopId: 1,
    market: newMarketState(),
    orders: [],
    nextOrderId: 1,
    ownerAt: null,
    staff: [],
    candidates: [],
    nextPersonId: 1,
    upgrades: {},
    xp: 0,
    level: 1,
    loans: [],
    nextLoanId: 1,
    events: [],
    news: [],
    won: false,
    bankrupt: false,
    weather: newWeatherState(),
    residents: [],
    rivals: [],
    nextRivalShopId: 1,
    offers: [],
    stats: {},
    achievements: {},
    campaigns: [],
    contracts: [],
    nextContractId: 1,
    franchises: [],
    franchiseOffers: [],
    nextFranchiseId: 1,
  };
}

/** The running game. Set when a game starts or loads; cleared on return to menu. */
export const session: { state: GameState; city: City } = {
  state: undefined as unknown as GameState,
  city: undefined as unknown as City,
};

export const shopById = (s: GameState, id: number): ShopState | undefined => s.shops.find((sh) => sh.id === id);
export const shopOnLot = (s: GameState, lotId: number): ShopState | undefined => s.shops.find((sh) => sh.lotId === lotId);
