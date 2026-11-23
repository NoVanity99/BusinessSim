import { session, shopOnLot } from '../../core/state';
import { defOf, objectTiles, WALL_SOLID } from '../../entities/Shop';
import { idx, T, type City, type LotDef } from '../city/generate';
import { allRivalShops, occupantOf } from '../rivals/rivals';

/** Walk cost per tile for pedestrians. 0 = blocked. */
export interface Grid {
  w: number;
  h: number;
  cost: Uint8Array;
}

const GROUND_COST: Record<number, number> = {
  [T.Sidewalk]: 10,
  [T.Crosswalk]: 10,
  [T.Path]: 10,
  [T.Park]: 16,
  [T.Sand]: 18,
  [T.Grass]: 20,
  [T.Lot]: 22,
};

export function buildGrid(city: City): Grid {
  const grid: Grid = { w: city.w, h: city.h, cost: new Uint8Array(city.w * city.h) };
  for (let i = 0; i < grid.cost.length; i++) grid.cost[i] = GROUND_COST[city.tiles[i]] ?? 0;
  for (const shop of session.state.shops) rebuildLot(grid, city, city.lots[shop.lotId]);
  for (const r of [...allRivalShops(session.state), ...session.state.franchises]) rebuildLot(grid, city, city.lots[r.lotId]);
  for (const [id, own] of Object.entries(session.state.lots)) if (own.tenant) rebuildLot(grid, city, city.lots[+id]);
  return grid;
}

/** Recompute walkability for one lot after its shop layout changed. */
export function rebuildLot(grid: Grid, city: City, lot: LotDef): void {
  const shop = shopOnLot(session.state, lot.id);
  // A rival's shop, a franchise or a tenant's premises: a building either way.
  const rival = !shop && (!!occupantOf(session.state, lot.id) || !!session.state.lots[lot.id]?.tenant);
  for (let y = 0; y < lot.h; y++) {
    for (let x = 0; x < lot.w; x++) {
      const gi = idx(city, lot.x + x, lot.y + y);
      if (!shop) {
        // A rival's building is solid; an empty lot is rough ground.
        grid.cost[gi] = rival ? 0 : GROUND_COST[city.tiles[gi]] ?? 0;
        continue;
      }
      const li = y * lot.w + x;
      grid.cost[gi] = shop.wall[li] === WALL_SOLID ? 0 : shop.floor[li] ? 10 : 22;
    }
  }
  if (!shop) return;
  for (const o of shop.objects) {
    if (defOf(o).walkable || defOf(o).anywhere) continue;
    for (const t of objectTiles(o)) grid.cost[idx(city, t.x, t.y)] = 0;
  }
}

export const walkable = (g: Grid, x: number, y: number): boolean => x >= 0 && y >= 0 && x < g.w && y < g.h && g.cost[y * g.w + x] > 0;
