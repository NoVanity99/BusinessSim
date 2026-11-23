import type { Customer } from '../../entities/Customer';
import type { Grid } from './grid';

/** A checkout's line. Rebuilt whenever the shop layout changes. */
export interface RegisterRuntime {
  shopId: number;
  objectId: number;
  /** Customer ids, front of the line first. */
  queue: number[];
  /** Tiles for each place in line; the first is directly in front of the checkout. */
  slots: number[];
  /** Game minutes spent serving the customer at the front. */
  progress: number;
}

export type StaffAgentState = 'arriving' | 'idle' | 'toTask' | 'working' | 'leaving';

/** An employee's body in the world while they are on shift. */
export interface StaffAgent {
  id: number;
  x: number;
  y: number;
  path: number[];
  goal: number;
  state: StaffAgentState;
  timer: number;
  /** Register a cashier is standing at, once they have arrived. */
  stationObj: number;
  taskObj: number;
  taskSlot: number;
  /** What they are doing, for the info panel. */
  activity: string;
}

/** A paid-for food order being prepared. */
export interface Ticket {
  customerId: number;
  items: { product: string; left: number; started: boolean }[];
  age: number;
}

export interface Car {
  id: number;
  x: number;
  y: number;
  /** Radians, for drawing. */
  heading: number;
  look: number;
  /** Remaining road tiles (reversed). */
  path: number[];
  state: 'drive' | 'toStation' | 'service' | 'toRoad';
  shopId: number;
  objId: number;
  timer: number;
  /** Services still to use at the station they pulled into. */
  todo: string[];
  /** Stations already considered on this trip. */
  seen: number[];
  /** Where to rejoin the road. */
  roadTile: number;
  /** Vending van: machines still to visit, as object ids. */
  van?: { shopId: number; stops: number[]; driverId: number };
}

/** Simulation state that is not saved: it is rebuilt when a game starts or loads. */
export const rt: {
  grid: Grid;
  customers: Customer[];
  byId: Map<number, Customer>;
  registers: Map<string, RegisterRuntime>;
  staff: Map<number, StaffAgent>;
  /** Customer ids currently holding a place on each station, keyed like registers. */
  stations: Map<string, number[]>;
  cars: Car[];
  roadGrid: Grid;
  roadEdges: number[];
  nextCarId: number;
  /** Vending machines by map tile. */
  vendingAt: Map<number, { shopId: number; objId: number }>;
  /** Open food orders per shop. */
  kitchens: Map<number, Ticket[]>;
  nextCustomerId: number;
  spawnPoints: { tile: number; weight: number; wealth: number }[];
  spawnWeightTotal: number;
  spawnDebt: number;
  /** Event-driven multipliers on how many people are out, and on demand per shop type. */
  crowdMult: number;
  demandMult: Record<string, number>;
  tournamentFee: number;
  /** Footfall per tile, decayed over time, for the foot-traffic overlay. */
  heat: Float32Array;
} = {
  grid: undefined as unknown as Grid,
  customers: [],
  byId: new Map(),
  registers: new Map(),
  staff: new Map(),
  stations: new Map(),
  cars: [],
  roadGrid: undefined as unknown as Grid,
  roadEdges: [],
  nextCarId: 1,
  vendingAt: new Map(),
  kitchens: new Map(),
  nextCustomerId: 1,
  spawnPoints: [],
  spawnWeightTotal: 0,
  spawnDebt: 0,
  crowdMult: 1,
  demandMult: {},
  tournamentFee: 8,
  heat: new Float32Array(0),
};

export const regKey = (shopId: number, objectId: number): string => `${shopId}:${objectId}`;
