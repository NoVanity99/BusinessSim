import neighborhoodsJson from './neighborhoods.json';
import cityJson from './city.json';
import difficultyJson from './difficulty.json';
import productsJson from './products.json';
import furnitureJson from './furniture.json';
import shopsJson from './shops.json';
import economyJson from './economy.json';
import populationJson from './population.json';

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

export type StorageClass = 'ambient' | 'chilled' | 'frozen';

export interface ProductDef {
  name: string;
  category: string;
  storage: StorageClass;
  /** Base cost per unit from the wholesaler. */
  wholesale: number;
  /** Base retail price customers consider fair. */
  market: number;
  caseSize: number;
  /** Days until it spoils; 0 = never. */
  shelfLife: number;
  /** Relative demand weight. */
  popularity: number;
  color: string;
}

/** `kind` selects the behaviour implemented in code; everything else is tuning data. */
export type FurnitureKind = 'floor' | 'wall' | 'door' | 'shelf' | 'register' | 'storage' | 'decor' | 'bin';

export interface FurnitureDef {
  name: string;
  category: string;
  kind: FurnitureKind;
  cost: number;
  color: string;
  description: string;
  /** Footprint in tiles before rotation (objects only). */
  w?: number;
  h?: number;
  /** Painter id in src/art/sprites.ts. */
  sprite?: string;
  /** Mood bonus for customers (negative = eyesore). */
  decor: number;
  walkable?: boolean;
  /** Shelf: number of distinct products and units per product. */
  slots?: number;
  slotCapacity?: number;
  accepts?: StorageClass[];
  /** Register: base seconds (game) to check out one customer. */
  checkoutSeconds?: number;
  /** Storage: units of back-room capacity added. */
  storage?: number;
  /** Electricity use, in utility units. */
  power?: number;
  light?: number;
}

export interface ShopTypeDef {
  name: string;
  description: string;
  color: string;
  licenseCost: number;
  unlockLevel: number;
  minArea: number;
  defaultHours: [number, number];
  baseStorage: number;
  defaultFloor: string;
  furniture: string[];
  products: string[];
  /** Share of all pedestrians out looking for this kind of business (all types together must stay below 1). */
  demand: number;
}

export interface EconomyConfig {
  wholesale: {
    deliveryFee: number;
    standardHours: number;
    expressHours: number;
    expressSurcharge: number;
    bulkDiscounts: { cases: number; discount: number }[];
  };
  market: { driftPerDay: number; minMult: number; maxMult: number };
  build: { sellBackShare: number; structureRefundShare: number };
  utilities: { basePerDay: number; perTilePerDay: number; perPowerUnitPerDay: number };
}

export const PRODUCTS = productsJson as Record<string, ProductDef>;
export const FURNITURE = furnitureJson as Record<string, FurnitureDef>;
export const SHOP_TYPES = shopsJson as unknown as Record<string, ShopTypeDef>;
export const ECONOMY = economyJson as EconomyConfig;

export interface PopulationConfig {
  /** Pedestrians on the map at the busiest hour, before difficulty and events. */
  basePopulation: number;
  maxPopulation: number;
  /** Activity multiplier for each hour of the day. */
  hourly: number[];
  weekendMult: number;
  /** Tiles per game minute. */
  walkSpeed: number;
  /** How close (in tiles) a shopper must pass to notice a shop. */
  noticeRadius: number;
  budgetMin: number;
  budgetMax: number;
  /** Game minutes a customer will queue before giving up. */
  patienceMin: number;
  patienceMax: number;
  firstNames: string[];
  lastNames: string[];
}

export const POPULATION = populationJson as PopulationConfig;
