import { TILE } from '../core/constants';
import { NEIGHBORHOODS } from '../data';
import { idx, T, type City, type LotDef } from '../systems/city/generate';
import { blit } from './atlas';
import { ROOF_COLORS } from './worldArt';

/**
 * Bakes the static city (ground, streets, other people's buildings) into chunk textures.
 * Everything is drawn from atlas frames, so restyling the city means changing the frames
 * registered in worldArt.ts, not this file.
 */

const CURB = '#7a77a4';

export function drawTile(ctx: CanvasRenderingContext2D, city: City, tx: number, ty: number, px: number, py: number): void {
  const t = city.tiles[idx(city, tx, ty)];
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= city.w || y >= city.h ? -1 : city.tiles[idx(city, x, y)]);
  const roadish = (v: number): boolean => v === T.Road || v === T.Crosswalk;
  switch (t) {
    case T.Road:
      // A dash on the seam between the two lanes; none inside intersections.
      if (!roadish(at(tx, ty - 1)) && roadish(at(tx, ty + 1)) && tx % 2 === 0) blit(ctx, 'road_dash_h', px, py);
      else if (!roadish(at(tx - 1, ty)) && roadish(at(tx + 1, ty)) && ty % 2 === 0) blit(ctx, 'road_dash_v', px, py);
      else blit(ctx, 'road', px, py);
      break;
    case T.Crosswalk:
      blit(ctx, at(tx, ty - 1) === T.Crosswalk || at(tx, ty + 1) === T.Crosswalk ? 'cross_a' : 'cross_b', px, py);
      break;
    case T.Sidewalk: {
      blit(ctx, 'pave', px, py);
      // Kerb along any edge that meets the road.
      ctx.fillStyle = CURB;
      if (roadish(at(tx, ty - 1))) ctx.fillRect(px, py, TILE, 2);
      if (roadish(at(tx, ty + 1))) ctx.fillRect(px, py + TILE - 2, TILE, 2);
      if (roadish(at(tx - 1, ty))) ctx.fillRect(px, py, 2, TILE);
      if (roadish(at(tx + 1, ty))) ctx.fillRect(px + TILE - 2, py, 2, TILE);
      break;
    }
    case T.Lot:
      blit(ctx, 'lot', px, py);
      break;
    case T.Building:
      blit(ctx, 'pave', px, py);
      break;
    case T.Path:
      blit(ctx, 'path', px, py);
      break;
    case T.Sand:
      blit(ctx, 'sand', px, py);
      break;
    case T.Water:
      blit(ctx, 'water', px, py);
      break;
    default:
      blit(ctx, 'grass', px, py);
  }
}

/** A non-player building: tiled roof, plus a wall with door and windows if it faces the camera. */
export function drawBuilding(ctx: CanvasRenderingContext2D, lot: LotDef, ox: number, oy: number): void {
  const style = NEIGHBORHOODS[lot.district].buildingStyle;
  const key = ROOF_COLORS[style] ? style : 'house';
  const variant = lot.style % 4;
  // The yard strip sits at the back of the lot.
  const top = lot.front === 'n' ? lot.y : lot.y + 1;
  const rows = lot.h - 1;
  // Buildings that face south show their front wall along the bottom row.
  const roofRows = lot.front === 's' ? rows - 1 : rows;
  const ridge = Math.floor((roofRows - 1) / 2);
  for (let y = 0; y < roofRows; y++) {
    const ry = y === 0 ? 0 : y === roofRows - 1 ? 3 : y === ridge ? 1 : 2;
    for (let x = 0; x < lot.w; x++) {
      const rx = x === 0 ? 0 : x === lot.w - 1 ? 2 : 1;
      blit(ctx, `roof_${key}${variant}_${rx}${ry}`, (lot.x + x) * TILE - ox, (top + y) * TILE - oy);
    }
  }
  if (lot.front !== 's') return;
  const door = Math.floor(lot.w / 2);
  for (let x = 0; x < lot.w; x++) {
    const piece = x === door ? '_door' : x % 2 === door % 2 ? '' : '_win';
    blit(ctx, `facade_${key}${piece}`, (lot.x + x) * TILE - ox, (top + roofRows) * TILE - oy);
  }
}

export const CHUNK_TILES = 32;

/**
 * Bakes the static city into chunk textures (each at most 1024x1024 px, safe for any GPU)
 * and returns the texture keys with their tile offsets.
 */
export function bakeCity(scene: Phaser.Scene, city: City): { key: string; tx: number; ty: number }[] {
  const out: { key: string; tx: number; ty: number }[] = [];
  for (let cy = 0; cy < city.h; cy += CHUNK_TILES) {
    for (let cx = 0; cx < city.w; cx += CHUNK_TILES) {
      const cw = Math.min(CHUNK_TILES, city.w - cx);
      const ch = Math.min(CHUNK_TILES, city.h - cy);
      const key = `city_${cx}_${cy}`;
      if (scene.textures.exists(key)) scene.textures.remove(key);
      const tex = scene.textures.createCanvas(key, cw * TILE, ch * TILE)!;
      const ctx = tex.getContext();
      ctx.imageSmoothingEnabled = false;
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) drawTile(ctx, city, cx + x, cy + y, x * TILE, y * TILE);
      // Buildings can straddle chunk borders; draw any that overlap and let the canvas clip.
      for (const lot of city.lots) {
        if (lot.rentable) continue;
        if (lot.x + lot.w < cx || lot.y + lot.h < cy || lot.x > cx + cw || lot.y > cy + ch) continue;
        drawBuilding(ctx, lot, cx * TILE, cy * TILE);
      }
      tex.refresh();
      out.push({ key, tx: cx, ty: cy });
    }
  }
  return out;
}
