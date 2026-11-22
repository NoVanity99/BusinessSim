import { TILE } from '../core/constants';
import { NEIGHBORHOODS } from '../data';
import { idx, T, type City, type LotDef } from '../systems/city/generate';
import { ROOFS, WORLD } from './palette';

/**
 * Procedural ground and building art, painted onto 2D canvases.
 * To use real sprites later, replace `drawTile` / `drawBuilding` with atlas blits;
 * nothing else in the game depends on how these pixels are produced.
 */

/** Cheap deterministic per-tile noise in [0, 1). */
function hash(x: number, y: number, k = 0): number {
  let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function speckle(ctx: CanvasRenderingContext2D, tx: number, ty: number, px: number, py: number, color: string, n: number): void {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const sx = Math.floor(hash(tx, ty, i * 2 + 1) * (TILE - 3));
    const sy = Math.floor(hash(tx, ty, i * 2 + 2) * (TILE - 3));
    ctx.fillRect(px + sx, py + sy, 3, 2);
  }
}

export function drawTile(ctx: CanvasRenderingContext2D, city: City, tx: number, ty: number, px: number, py: number): void {
  const t = city.tiles[idx(city, tx, ty)];
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= city.w || y >= city.h ? -1 : city.tiles[idx(city, x, y)]);
  switch (t) {
    case T.Road: {
      ctx.fillStyle = WORLD.road;
      ctx.fillRect(px, py, TILE, TILE);
      // Dashed centre line on the seam between the two lanes. Intersections get none
      // because there every neighbour is road.
      const roadish = (v: number): boolean => v === T.Road || v === T.Crosswalk;
      ctx.fillStyle = WORLD.roadLine;
      if (!roadish(at(tx, ty - 1)) && roadish(at(tx, ty + 1)) && tx % 2 === 0) ctx.fillRect(px + 6, py + TILE - 1, 20, 2);
      if (!roadish(at(tx - 1, ty)) && roadish(at(tx + 1, ty)) && ty % 2 === 0) ctx.fillRect(px + TILE - 1, py + 6, 2, 20);
      break;
    }
    case T.Crosswalk: {
      ctx.fillStyle = WORLD.road;
      ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = WORLD.crosswalk;
      const alongX = at(tx, ty - 1) === T.Crosswalk || at(tx, ty + 1) === T.Crosswalk;
      for (let i = 0; i < 4; i++) {
        if (alongX) ctx.fillRect(px + 4, py + 2 + i * 8, TILE - 8, 4);
        else ctx.fillRect(px + 2 + i * 8, py + 4, 4, TILE - 8);
      }
      break;
    }
    case T.Sidewalk:
      ctx.fillStyle = WORLD.sidewalk;
      ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = WORLD.sidewalkLine;
      ctx.fillRect(px, py, TILE, 1);
      ctx.fillRect(px, py, 1, TILE);
      break;
    case T.Lot:
      ctx.fillStyle = WORLD.lot;
      ctx.fillRect(px, py, TILE, TILE);
      speckle(ctx, tx, ty, px, py, WORLD.lotLine, 3);
      break;
    case T.Building:
      ctx.fillStyle = WORLD.sidewalk;
      ctx.fillRect(px, py, TILE, TILE);
      break;
    case T.Path:
      ctx.fillStyle = WORLD.path;
      ctx.fillRect(px, py, TILE, TILE);
      break;
    case T.Sand:
      ctx.fillStyle = WORLD.sand;
      ctx.fillRect(px, py, TILE, TILE);
      speckle(ctx, tx, ty, px, py, '#d9c688', 2);
      break;
    case T.Water:
      ctx.fillStyle = WORLD.water;
      ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = WORLD.waterLight;
      if (hash(tx, ty) > 0.45) ctx.fillRect(px + Math.floor(hash(tx, ty, 3) * 16), py + Math.floor(hash(tx, ty, 4) * 26), 12, 2);
      break;
    case T.Park:
    case T.Tree:
    case T.Grass:
    default: {
      ctx.fillStyle = t === T.Park ? WORLD.park : WORLD.grass;
      ctx.fillRect(px, py, TILE, TILE);
      speckle(ctx, tx, ty, px, py, WORLD.grassDark, 3);
      if (t === T.Tree) {
        ctx.fillStyle = WORLD.trunkShadow;
        ctx.beginPath();
        ctx.ellipse(px + 18, py + 20, 12, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = WORLD.tree;
        ctx.beginPath();
        ctx.arc(px + 16, py + 16, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = WORLD.treeLight;
        ctx.beginPath();
        ctx.arc(px + 13, py + 13, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

/** Roof of a non-player building, drawn in pixel coords relative to the canvas origin. */
export function drawBuilding(ctx: CanvasRenderingContext2D, lot: LotDef, ox: number, oy: number): void {
  const style = NEIGHBORHOODS[lot.district].buildingStyle;
  const [roof, roofDark, detail] = (ROOFS[style] ?? ROOFS.house)[lot.style % 4];
  // The yard strip sits at the back of the lot.
  const x = lot.x * TILE - ox + 3;
  const y = (lot.front === 'n' ? lot.y : lot.y + 1) * TILE - oy + 3;
  const w = lot.w * TILE - 6;
  const h = (lot.h - 1) * TILE - 6;

  ctx.fillStyle = WORLD.shadow;
  ctx.fillRect(x + 4, y + 4, w, h);
  ctx.fillStyle = roofDark;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = roof;
  ctx.fillRect(x + 3, y + 3, w - 6, h - 6);

  if (style === 'house') {
    // Ridge line and a chimney.
    ctx.fillStyle = roofDark;
    ctx.fillRect(x + 3, y + h / 2 - 1, w - 6, 3);
    ctx.fillStyle = detail;
    ctx.fillRect(x + w - 22, y + 12, 8, 8);
  } else if (style === 'office' || style === 'resort') {
    // Skylights / rooftop units in a grid.
    ctx.fillStyle = detail;
    for (let gy = y + 12; gy + 10 < y + h - 8; gy += 26) {
      for (let gx = x + 12; gx + 14 < x + w - 8; gx += 28) ctx.fillRect(gx, gy, 14, 10);
    }
  } else if (style === 'warehouse') {
    ctx.fillStyle = roofDark;
    for (let gx = x + 14; gx < x + w - 6; gx += 14) ctx.fillRect(gx, y + 3, 2, h - 6);
    ctx.fillStyle = detail;
    ctx.fillRect(x + 10, y + 10, 16, 12);
  } else {
    ctx.fillStyle = detail;
    ctx.fillRect(x + 8, y + 8, w - 16, 3);
    ctx.fillRect(x + 8, y + h - 11, w - 16, 3);
  }

  // Door mat on the street side, hinting where residents come and go.
  ctx.fillStyle = '#4a3b2f';
  const doorX = x + Math.floor(w / 2) - 7;
  ctx.fillRect(doorX, lot.front === 'n' ? y - 1 : y + h - 3, 14, 4);
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
