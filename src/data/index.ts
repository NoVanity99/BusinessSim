import neighborhoodsJson from './neighborhoods.json';
import cityJson from './city.json';
import difficultyJson from './difficulty.json';
import productsJson from './products.json';
import furnitureJson from './furniture.json';
import shopsJson from './shops.json';
import economyJson from './economy.json';
import populationJson from './population.json';
import employeesJson from './employees.json';

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

export type StorageClass = 'ambient' | 'chilled' | 'frozen' | 'collectible';

/**
 * good: bought wholesale, sold from shelves.   menu: made to order from a recipe.
 * ingredient: consumed by recipes.            service: time on a machine or attraction.
 * collectible: single cards from opened packs. crafted: made in your factory.
 * fuel: sold through pumps.
 */
export type ProductKind = 'good' | 'menu' | 'ingredient' | 'service' | 'collectible' | 'crafted' | 'fuel';

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
  kind?: ProductKind;
  /** Inputs consumed per run (menu item, production batch or service). */
  recipe?: Record<string, number>;
  /** Station type that makes it, matching a furniture `station`. */
  station?: string;
  /** Game minutes to prepare one (menu) or one batch (production). */
  prepMinutes?: number;
  /** Units produced per production run. */
  batch?: number;
  /** Game minutes a service takes. */
  duration?: number;
  /** Multiplier on daily price drift. */
  volatility?: number;
}

/** `kind` selects the behaviour implemented in code; everything else is tuning data. */
export type FurnitureKind = 'floor' | 'wall' | 'door' | 'shelf' | 'register' | 'storage' | 'decor' | 'bin' | 'service' | 'seat' | 'cookstation' | 'producer' | 'vending';

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
  /** Service kind: product id of a paid service, or a free one such as 'ride', 'play' or 'fuel'. */
  service?: string;
  /** How many customers can use it at once. */
  capacity?: number;
  /** Game minutes per use, overriding the service's own duration. */
  duration?: number;
  /** Mood gained by using it. */
  fun?: number;
  /** Chance to break down after each use or batch. */
  breakChance?: number;
  repairCost?: number;
  /** Cook station or producer type, matched against product `station`. */
  station?: string;
  /** Producer runs without staff. */
  auto?: boolean;
  /** Used by cars rather than pedestrians. */
  vehicle?: boolean;
  /** Only usable while someone with this role is on shift. */
  needsRole?: string;
  outdoor?: boolean;
  /** Can be placed on any pavement in the city. */
  anywhere?: boolean;
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
  /** How customers use the place; selects the behaviour in the AI. */
  flow: 'retail' | 'counter' | 'service' | 'park' | 'depot' | 'factory';
  furniture: string[];
  /** Everything it sells and prices. */
  products: string[];
  /** Extra things it can order that are not sold directly. */
  supplies: string[];
  /** Services every customer uses, in order (service flow). */
  plan?: string[];
  /** Optional services customers may use after shopping. */
  after?: string[];
  /** How strongly decor raises the prices customers accept. */
  decorWeight?: number;
  /** Relative rate of cars pulling in. */
  carDemand?: number;
  openAir?: boolean;
  /** Share of the lot's depth taken by the building; the rest is an open forecourt. */
  shellDepth?: number;
  forecourtFloor?: string;
  /** Staff roles that are useful here. */
  roles: string[];
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
  traffic: {
    /** Cars on the road at the busiest hour. */
    cars: number;
    /** Tiles per game minute. */
    speed: number;
    /** Chance a passing car pulls into an open gas station at average reputation. */
    fuelStopChance: number;
    washChance: number;
    martChance: number;
    /** Cars per hour that come in for repairs when a bay is staffed. */
    repairPerHour: number;
  };
}

export const POPULATION = populationJson as PopulationConfig;

export interface RoleDef {
  name: string;
  /** Base hourly wage for an average worker. */
  wage: number;
  color: string;
  description: string;
}

/** Numeric modifiers a trait applies; all optional. */
export interface TraitDef {
  name: string;
  description: string;
  speed?: number;
  friendliness?: number;
  reliability?: number;
  wageMult?: number;
  energyDrain?: number;
  moraleBase?: number;
  carry?: number;
  learn?: number;
  theft?: number;
  nightOwl?: boolean;
  noQuit?: boolean;
  /** Not shown on the hiring screen. */
  hidden?: boolean;
}

export interface EmployeeConfig {
  candidatePoolSize: number;
  hiringFee: number;
  overtimeAfterHours: number;
  overtimeMult: number;
  roles: Record<string, RoleDef>;
  traits: Record<string, TraitDef>;
}

export const EMPLOYEES = employeesJson as EmployeeConfig;
