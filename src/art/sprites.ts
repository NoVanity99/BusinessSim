import { TILE } from '../core/constants';
import { FURNITURE, type FurnitureDef } from '../data';

/**
 * Procedural furniture art. Each painter draws the object facing south (front edge at the bottom)
 * into a canvas of footprint size. To use real art, preload an image under the key
 * `furn_<id>` before the city scene starts and the painter is skipped.
 */
type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number, def: FurnitureDef) => void;

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number): number => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, r = 3): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

const base: Painter = (ctx, w, h, def) => {
  box(ctx, 3, 4, w - 4, h - 4, 'rgba(0,0,0,0.22)');
  box(ctx, 2, 2, w - 4, h - 4, shade(def.color, -0.12));
  box(ctx, 4, 4, w - 8, h - 8, def.color);
};

const PAINTERS: Record<string, Painter> = {
  shelf(ctx, w, h, def) {
    base(ctx, w, h, def);
    ctx.fillStyle = shade(def.color, -0.2);
    for (let x = 4 + (w - 8) / 4; x < w - 6; x += (w - 8) / 4) ctx.fillRect(x, 4, 1.5, h - 8);
    ctx.fillRect(4, h - 9, w - 8, 3);
  },
  rack(ctx, w, h, def) {
    base(ctx, w, h, def);
    ctx.fillStyle = shade(def.color, 0.15);
    for (let y = 8; y < h - 8; y += 6) ctx.fillRect(7, y, w - 14, 2);
  },
  fridge(ctx, w, h, def) {
    base(ctx, w, h, def);
    // Glass doors along the front.
    box(ctx, 5, h - 13, w / 2 - 6, 8, '#9fd0f0', 2);
    box(ctx, w / 2 + 1, h - 13, w / 2 - 6, 8, '#9fd0f0', 2);
    ctx.fillStyle = '#6f7d8c';
    ctx.fillRect(5, 6, w - 10, 4);
  },
  freezer(ctx, w, h, def) {
    base(ctx, w, h, def);
    box(ctx, 7, 8, w - 14, h - 16, '#e9f4fb', 4);
    ctx.fillStyle = '#9fd0f0';
    ctx.fillRect(w / 2 - 1, 8, 2, h - 16);
  },
  register(ctx, w, h, def) {
    base(ctx, w, h, def);
    box(ctx, 8, 7, w - 16, 10, '#20262f', 2);
    box(ctx, 10, 9, w - 20, 5, '#7fe3b0', 1);
    box(ctx, 9, 20, w - 18, 6, '#c8ccd3', 1);
  },
  storage(ctx, w, h, def) {
    base(ctx, w, h, def);
    const colors = ['#c9a36a', '#b58d55', '#d4b27e'];
    let i = 0;
    for (let x = 7; x + 12 <= w - 5; x += 14) box(ctx, x, 8, 11, h - 16, colors[i++ % 3], 1);
  },
  plant(ctx, w, h, def) {
    box(ctx, w / 2 - 7, h / 2 - 5, 16, 16, 'rgba(0,0,0,0.2)', 8);
    ctx.fillStyle = '#9a5b3c';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = def.color;
    for (let a = 0; a < 6; a++) {
      ctx.beginPath();
      ctx.ellipse(w / 2 + Math.cos(a) * 6, h / 2 + Math.sin(a) * 6, 6, 4, a, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  lamp(ctx, w, h, def) {
    const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, 15);
    g.addColorStop(0, 'rgba(255,240,170,0.9)');
    g.addColorStop(1, 'rgba(255,240,170,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#3d4450';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 4, 0, Math.PI * 2);
    ctx.fill();
  },
  rug(ctx, w, h, def) {
    box(ctx, 3, 5, w - 6, h - 10, def.color, 2);
    ctx.strokeStyle = shade(def.color, 0.25);
    ctx.lineWidth = 2;
    ctx.strokeRect(7, 9, w - 14, h - 18);
  },
  bin(ctx, w, h, def) {
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.arc(w / 2 + 1, h / 2 + 2, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shade(def.color, -0.2);
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 5, 0, Math.PI * 2);
    ctx.fill();
  },
};

export function furnitureTexture(scene: Phaser.Scene, defId: string): string {
  const key = `furn_${defId}`;
  if (scene.textures.exists(key)) return key;
  const def = FURNITURE[defId];
  const w = (def.w ?? 1) * TILE;
  const h = (def.h ?? 1) * TILE;
  const tex = scene.textures.createCanvas(key, w, h)!;
  (PAINTERS[def.sprite ?? ''] ?? base)(tex.getContext(), w, h, def);
  tex.refresh();
  return key;
}

/** Paint one floor tile. */
export function drawFloor(ctx: CanvasRenderingContext2D, defId: string, px: number, py: number, tx: number, ty: number): void {
  const def = FURNITURE[defId];
  ctx.fillStyle = def.color;
  ctx.fillRect(px, py, TILE, TILE);
  ctx.fillStyle = shade(def.color, -0.07);
  if (defId === 'floor_wood') {
    for (let y = 0; y < TILE; y += 8) ctx.fillRect(px, py + y, TILE, 1);
    ctx.fillRect(px + ((tx + ty) % 2 ? 10 : 22), py, 1, TILE);
  } else if (defId === 'floor_tile') {
    ctx.fillRect(px, py, TILE, 1);
    ctx.fillRect(px, py, 1, TILE);
    ctx.fillRect(px + 16, py, 1, TILE);
    ctx.fillRect(px, py + 16, TILE, 1);
  } else {
    ctx.fillRect(px, py, TILE, 1);
    ctx.fillRect(px, py, 1, TILE);
  }
}

export function drawWall(ctx: CanvasRenderingContext2D, px: number, py: number): void {
  const c = FURNITURE.wall.color;
  ctx.fillStyle = shade(c, -0.12);
  ctx.fillRect(px, py, TILE, TILE);
  ctx.fillStyle = c;
  ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
  ctx.fillStyle = shade(c, 0.1);
  ctx.fillRect(px + 2, py + 2, TILE - 4, 3);
}

/** A door sits in a wall line; `horizontal` means the wall runs left-right. */
export function drawDoor(ctx: CanvasRenderingContext2D, px: number, py: number, horizontal: boolean): void {
  ctx.fillStyle = '#d8cfc0';
  ctx.fillRect(px, py, TILE, TILE);
  ctx.fillStyle = FURNITURE.door.color;
  if (horizontal) ctx.fillRect(px + 2, py + 12, TILE - 4, 8);
  else ctx.fillRect(px + 12, py + 2, 8, TILE - 4);
  ctx.fillStyle = shade(FURNITURE.wall.color, -0.12);
  if (horizontal) {
    ctx.fillRect(px, py + 8, 3, 16);
    ctx.fillRect(px + TILE - 3, py + 8, 3, 16);
  } else {
    ctx.fillRect(px + 8, py, 16, 3);
    ctx.fillRect(px + 8, py + TILE - 3, 16, 3);
  }
}
