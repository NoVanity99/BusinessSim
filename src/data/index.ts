import neighborhoodsJson from './neighborhoods.json';
import cityJson from './city.json';
import difficultyJson from './difficulty.json';

export interface NeighborhoodDef {
  name: string;
  description: string;
  color: string;
  /** Multiplier on how many pedestrians spawn. */
  footTraffic: number;
  /** Multiplier on customer budgets and price tolerance. */
  wealth: number;
  /** Daily rent per lot tile. */
  rentPerTile: number;
  buildingStyle: string;
}

export interface DifficultyDef {
  name: string;
  description: string;
  startingMoney: number;
  costMult: number;
  patienceMult: number;
  loanInterestMult: number;
  netWorthGoal: number;
}

export interface CityConfig {
  seed: number;
  blocksX: number;
  blocksY: number;
  blockW: number;
  blockH: number;
  roadW: number;
  sidewalkW: number;
  waterRows: number;
  sandRows: number;
  rentableShare: number;
  purchasePriceDays: number;
  lotWidths: number[];
  bigLotBlockChance: number;
  districts: string[][];
  parkBlocks: number[][];
}

export const NEIGHBORHOODS = neighborhoodsJson as Record<string, NeighborhoodDef>;
export const CITY_CONFIG = cityJson as CityConfig;
export const DIFFICULTIES = difficultyJson as Record<string, DifficultyDef>;
