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

/** Simulation state that is not saved: it is rebuilt when a game starts or loads. */
export const rt: {
  grid: Grid;
  customers: Customer[];
  byId: Map<number, Customer>;
  registers: Map<string, RegisterRuntime>;
  staff: Map<number, StaffAgent>;
  nextCustomerId: number;
  spawnPoints: { tile: number; weight: number; wealth: number }[];
  spawnWeightTotal: number;
  spawnDebt: number;
} = {
  grid: undefined as unknown as Grid,
  customers: [],
  byId: new Map(),
  registers: new Map(),
  staff: new Map(),
  nextCustomerId: 1,
  spawnPoints: [],
  spawnWeightTotal: 0,
  spawnDebt: 0,
};

export const regKey = (shopId: number, objectId: number): string => `${shopId}:${objectId}`;
