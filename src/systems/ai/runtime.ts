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

/** Simulation state that is not saved: it is rebuilt when a game starts or loads. */
export const rt: {
  grid: Grid;
  customers: Customer[];
  byId: Map<number, Customer>;
  registers: Map<string, RegisterRuntime>;
  nextCustomerId: number;
  spawnPoints: { tile: number; weight: number; wealth: number }[];
  spawnWeightTotal: number;
  spawnDebt: number;
} = {
  grid: undefined as unknown as Grid,
  customers: [],
  byId: new Map(),
  registers: new Map(),
  nextCustomerId: 1,
  spawnPoints: [],
  spawnWeightTotal: 0,
  spawnDebt: 0,
};

export const regKey = (shopId: number, objectId: number): string => `${shopId}:${objectId}`;
