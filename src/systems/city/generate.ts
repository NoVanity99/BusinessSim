import { CITY_CONFIG, NEIGHBORHOODS, type CityConfig } from '../../data';
import { Rng } from '../../core/rng';

export const enum T {
  Grass = 0,
  Road = 1,
  Sidewalk = 2,
  Crosswalk = 3,
  Lot = 4,
  Building = 5,
  Park = 6,
  Tree = 7,
  Sand = 8,
  Water = 9,
  Path = 10,
}

export type Side = 'n' | 's';

/** Static description of a plot of land. Ownership lives in GameState. */
export interface LotDef {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  district: string;
  /** Which edge touches the sidewalk. */
  front: Side;
  rentable: boolean;
  /** Rent per day. */
  rent: number;
  price: number;
  /** Filler building roof colour index, for non-rentable lots. */
  style: number;
}

export interface City {
  w: number;
  h: number;
  tiles: Uint8Array;
  /** Lot id per tile, or -1. */
  lotAt: Int16Array;
  /** District index per tile (into `districtIds`). */
  districtAt: Uint8Array;
  districtIds: string[];
  lots: LotDef[];
}

export const idx = (city: { w: number }, x: number, y: number): number => y * city.w + x;

export function generateCity(cfg: CityConfig = CITY_CONFIG): City {
  const rng = new Rng(cfg.seed);
  const street = cfg.roadW + cfg.sidewalkW * 2;
  const w = street + cfg.blocksX * (cfg.blockW + street);
  const landH = street + cfg.blocksY * (cfg.blockH + street);
  const h = landH + cfg.sandRows + cfg.waterRows;

  const tiles = new Uint8Array(w * h).fill(T.Grass);
  const lotAt = new Int16Array(w * h).fill(-1);
  const districtAt = new Uint8Array(w * h);
  const districtIds = Object.keys(NEIGHBORHOODS);
  const lots: LotDef[] = [];
  const city: City = { w, h, tiles, lotAt, districtAt, districtIds, lots };

  const set = (x: number, y: number, t: T): void => {
    if (x >= 0 && y >= 0 && x < w && y < h) tiles[idx(city, x, y)] = t;
  };
  const fill = (x0: number, y0: number, fw: number, fh: number, t: T): void => {
    for (let y = y0; y < y0 + fh; y++) for (let x = x0; x < x0 + fw; x++) set(x, y, t);
  };

  // Streets: sidewalk band with the road down the middle.
  for (let by = 0; by <= cfg.blocksY; by++) {
    const y0 = by * (cfg.blockH + street);
    fill(0, y0, w, street, T.Sidewalk);
  }
  for (let bx = 0; bx <= cfg.blocksX; bx++) {
    const x0 = bx * (cfg.blockW + street);
    fill(x0, 0, street, landH, T.Sidewalk);
  }
  for (let by = 0; by <= cfg.blocksY; by++) {
    fill(0, by * (cfg.blockH + street) + cfg.sidewalkW, w, cfg.roadW, T.Road);
  }
  for (let bx = 0; bx <= cfg.blocksX; bx++) {
    fill(bx * (cfg.blockW + street) + cfg.sidewalkW, 0, cfg.roadW, landH, T.Road);
  }
  // Crosswalks on each side of every intersection.
  for (let by = 0; by <= cfg.blocksY; by++) {
    for (let bx = 0; bx <= cfg.blocksX; bx++) {
      const x0 = bx * (cfg.blockW + street);
      const y0 = by * (cfg.blockH + street);
      if (bx > 0) fill(x0 - 1, y0 + cfg.sidewalkW, 1, cfg.roadW, T.Crosswalk);
      if (bx < cfg.blocksX) fill(x0 + street, y0 + cfg.sidewalkW, 1, cfg.roadW, T.Crosswalk);
      if (by > 0) fill(x0 + cfg.sidewalkW, y0 - 1, cfg.roadW, 1, T.Crosswalk);
      if (by < cfg.blocksY) fill(x0 + cfg.sidewalkW, y0 + street, cfg.roadW, 1, T.Crosswalk);
    }
  }

  // Beach strip below the last street.
  fill(0, landH, w, cfg.sandRows, T.Sand);
  fill(0, landH + cfg.sandRows, w, cfg.waterRows, T.Water);

  // District per tile: nearest block decides, so streets belong to a district too.
  for (let y = 0; y < h; y++) {
    const by = Math.min(cfg.blocksY - 1, Math.max(0, Math.floor((y - street / 2) / (cfg.blockH + street))));
    for (let x = 0; x < w; x++) {
      const bx = Math.min(cfg.blocksX - 1, Math.max(0, Math.floor((x - street / 2) / (cfg.blockW + street))));
      districtAt[idx(city, x, y)] = Math.max(0, districtIds.indexOf(cfg.districts[by][bx]));
    }
  }

  const addLot = (x: number, y: number, lw: number, lh: number, district: string, front: Side, rentable: boolean): void => {
    const n = NEIGHBORHOODS[district];
    // Bigger lots are a little cheaper per tile; rounded to a tidy number.
    const area = lw * lh;
    const rent = Math.round((area * n.rentPerTile * (1 - Math.min(0.25, area / 800))) / 5) * 5;
    const lot: LotDef = {
      id: lots.length,
      x, y, w: lw, h: lh, district, front, rentable,
      rent,
      price: Math.round((rent * cfg.purchasePriceDays) / 500) * 500,
      style: rng.int(0, 3),
    };
    lots.push(lot);
    for (let ty = y; ty < y + lh; ty++) {
      for (let tx = x; tx < x + lw; tx++) {
        lotAt[idx(city, tx, ty)] = lot.id;
        tiles[idx(city, tx, ty)] = rentable ? T.Lot : T.Building;
      }
    }
    if (!rentable) {
      // Leave a strip of yard behind filler buildings so blocks do not look like slabs.
      const yardY = front === 'n' ? y + lh - 1 : y;
      for (let tx = x; tx < x + lw; tx++) tiles[idx(city, tx, yardY)] = rng.chance(0.3) ? T.Tree : T.Grass;
    }
  };

  const isPark = (bx: number, by: number): boolean => cfg.parkBlocks.some(([px, py]) => px === bx && py === by);

  for (let by = 0; by < cfg.blocksY; by++) {
    for (let bx = 0; bx < cfg.blocksX; bx++) {
      const x0 = street + bx * (cfg.blockW + street);
      const y0 = street + by * (cfg.blockH + street);
      const district = cfg.districts[by][bx];

      if (isPark(bx, by)) {
        fill(x0, y0, cfg.blockW, cfg.blockH, T.Park);
        const midY = y0 + Math.floor(cfg.blockH / 2);
        const midX = x0 + Math.floor(cfg.blockW / 2);
        fill(x0, midY, cfg.blockW, 1, T.Path);
        fill(midX, y0, 1, cfg.blockH, T.Path);
        for (let i = 0; i < 26; i++) {
          const tx = rng.int(x0, x0 + cfg.blockW - 1);
          const ty = rng.int(y0, y0 + cfg.blockH - 1);
          if (tiles[idx(city, tx, ty)] === T.Park) set(tx, ty, T.Tree);
        }
        continue;
      }

      const big = rng.chance(cfg.bigLotBlockChance) || district === 'industrial';
      if (big && rng.chance(0.5)) {
        // Whole-block lots: one or two large plots for parks and factories.
        if (rng.chance(0.5)) {
          addLot(x0, y0, cfg.blockW, cfg.blockH, district, 's', true);
        } else {
          const half = cfg.blockW / 2;
          addLot(x0, y0, half, cfg.blockH, district, 's', rng.chance(0.7));
          addLot(x0 + half, y0, half, cfg.blockH, district, 's', rng.chance(0.7));
        }
        continue;
      }

      // Two rows of lots, back to back, each facing its own street.
      const half = cfg.blockH / 2;
      for (const front of ['n', 's'] as Side[]) {
        const ly = front === 'n' ? y0 : y0 + half;
        let lx = x0;
        while (lx < x0 + cfg.blockW) {
          const remaining = x0 + cfg.blockW - lx;
          let lw = rng.pick(cfg.lotWidths);
          if (lw > remaining || remaining - lw < cfg.lotWidths[0]) lw = remaining;
          addLot(lx, ly, lw, half, district, front, rng.chance(cfg.rentableShare));
          lx += lw;
        }
      }
    }
  }

  return city;
}

/** Tiles pedestrians may walk on outside buildings. */
export function isWalkableGround(t: number): boolean {
  return t === T.Sidewalk || t === T.Crosswalk || t === T.Path || t === T.Park || t === T.Sand || t === T.Lot || t === T.Grass;
}
