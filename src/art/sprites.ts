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


/** Helpers for the simpler painters. */
function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

const MORE: Record<string, Painter> = {
  washer(ctx, w, h, def) {
    base(ctx, w, h, def);
    disc(ctx, w / 2, h / 2 + 2, 8, '#6f7d8c');
    disc(ctx, w / 2, h / 2 + 2, 6, '#9fd0f0');
    ctx.fillStyle = '#5aa9e6';
    ctx.fillRect(6, 5, 6, 3);
  },
  dryer(ctx, w, h, def) {
    base(ctx, w, h, def);
    disc(ctx, w / 2, h / 2 + 2, 8, '#6f7d8c');
    disc(ctx, w / 2, h / 2 + 2, 6, '#3d4450');
    ctx.fillStyle = '#e58f4f';
    ctx.fillRect(6, 5, 6, 3);
  },
  bench(ctx, w, h, def) {
    box(ctx, 4, 9, w - 6, h - 16, 'rgba(0,0,0,0.2)');
    box(ctx, 3, 8, w - 6, h - 16, def.color, 2);
    ctx.fillStyle = shade(def.color, -0.18);
    for (let x = 10; x < w - 6; x += 10) ctx.fillRect(x, 8, 1.5, h - 16);
  },
  table(ctx, w, h, def) {
    const chair = shade(def.color, -0.25);
    box(ctx, 3, 9, 8, h - 18, chair, 2);
    box(ctx, w - 11, 9, 8, h - 18, chair, 2);
    box(ctx, 13, 5, w - 24, h - 8, 'rgba(0,0,0,0.2)', 3);
    box(ctx, 12, 4, w - 24, h - 8, def.color, 3);
  },
  grill(ctx, w, h, def) {
    base(ctx, w, h, def);
    ctx.fillStyle = '#1c222c';
    ctx.fillRect(6, 6, w - 12, h - 14);
    ctx.fillStyle = '#e5605a';
    for (let x = 8; x < w - 8; x += 4) ctx.fillRect(x, 8, 1.5, h - 18);
  },
  fryer(ctx, w, h, def) {
    base(ctx, w, h, def);
    box(ctx, 6, 6, w / 2 - 8, h - 14, '#e8c468', 2);
    box(ctx, w / 2 + 2, 6, w / 2 - 8, h - 14, '#d9a05b', 2);
  },
  drinks(ctx, w, h, def) {
    base(ctx, w, h, def);
    const taps = ['#d9534f', '#f2b84b', '#5aa9e6'];
    taps.forEach((c, i) => box(ctx, 6 + i * 7, 7, 5, 12, c, 1));
  },
  espresso(ctx, w, h, def) {
    base(ctx, w, h, def);
    box(ctx, 6, 6, w - 12, 8, '#3d4450', 2);
    disc(ctx, 11, 21, 3.5, '#5a3825');
    disc(ctx, w - 11, 21, 3.5, '#5a3825');
  },
  oven(ctx, w, h, def) {
    base(ctx, w, h, def);
    box(ctx, 6, 7, w - 12, h - 15, '#20262f', 2);
    box(ctx, 8, 9, w - 16, h - 19, '#e58f4f', 1);
  },
  case(ctx, w, h, def) {
    base(ctx, w, h, def);
    box(ctx, 5, 5, w - 10, h - 10, 'rgba(159,208,240,0.75)', 2);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(8, 7, w - 16, 2);
  },
  playtable(ctx, w, h, def) {
    const chair = '#6b5548';
    for (const [x, y] of [[w / 2 - 14, 3], [w / 2 + 6, 3], [w / 2 - 14, h - 11], [w / 2 + 6, h - 11]]) box(ctx, x, y, 8, 8, chair, 2);
    box(ctx, 9, 12, w - 16, h - 22, 'rgba(0,0,0,0.2)', 4);
    box(ctx, 8, 11, w - 16, h - 22, def.color, 4);
    box(ctx, w / 2 - 6, h / 2 - 4, 5, 7, '#f2f2f2', 1);
    box(ctx, w / 2 + 2, h / 2 - 4, 5, 7, '#f2b84b', 1);
  },
  mixer(ctx, w, h, def) {
    base(ctx, w, h, def);
    disc(ctx, w / 2, h / 2, Math.min(w, h) / 2 - 8, shade(def.color, -0.25));
    disc(ctx, w / 2, h / 2, Math.min(w, h) / 2 - 12, shade(def.color, 0.15));
    ctx.fillStyle = shade(def.color, -0.3);
    ctx.fillRect(w / 2 - 1.5, 8, 3, h - 16);
    ctx.fillRect(8, h / 2 - 1.5, w - 16, 3);
  },
  bottler(ctx, w, h, def) {
    base(ctx, w, h, def);
    ctx.fillStyle = '#20262f';
    ctx.fillRect(6, h / 2 - 3, w - 12, 6);
    for (let x = 10; x < w - 8; x += 9) disc(ctx, x, h / 2, 3, '#e9f4fb');
  },
  pump(ctx, w, h, def) {
    box(ctx, 7, 5, w - 12, h - 8, 'rgba(0,0,0,0.25)', 3);
    box(ctx, 6, 4, w - 12, h - 8, def.color, 3);
    box(ctx, 9, 7, w - 18, 8, '#f2f2f2', 1);
    ctx.fillStyle = '#20262f';
    ctx.fillRect(w - 9, 10, 3, 12);
  },
  tank(ctx, w, h, def) {
    box(ctx, 4, 4, w - 8, h - 8, shade(def.color, -0.15), 6);
    disc(ctx, w / 2, h / 2, 9, shade(def.color, 0.1));
    disc(ctx, w / 2, h / 2, 5, '#3d4450');
  },
  carwash(ctx, w, h, def) {
    box(ctx, 3, 3, w - 6, h - 6, '#b9bcc2', 3);
    box(ctx, 8, 3, w - 16, h - 6, '#8f9bb0', 0);
    ctx.fillStyle = def.color;
    for (let y = 10; y < h - 8; y += 14) {
      ctx.fillRect(3, y, 6, 8);
      ctx.fillRect(w - 9, y, 6, 8);
    }
  },
  repairbay(ctx, w, h, def) {
    box(ctx, 3, 3, w - 6, h - 6, '#6b7686', 3);
    box(ctx, 8, 8, w - 16, h - 16, '#3d4450', 2);
    ctx.fillStyle = '#f2b84b';
    for (let y = 10; y < h - 12; y += 12) ctx.fillRect(10, y, w - 20, 3);
    void def;
  },
  vending(ctx, w, h, def) {
    box(ctx, 5, 4, w - 8, h - 6, 'rgba(0,0,0,0.25)', 2);
    box(ctx, 4, 3, w - 8, h - 6, def.color, 2);
    box(ctx, 7, 6, w - 18, h - 12, '#20262f', 1);
    const dots = ['#f2b84b', '#7cc576', '#5aa9e6', '#f2f2f2'];
    dots.forEach((c, i) => disc(ctx, 10 + (i % 2) * 6, 10 + Math.floor(i / 2) * 7, 2, c));
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(w - 9, 8, 3, 6);
  },
  gate(ctx, w, h, def) {
    box(ctx, 3, 8, w - 6, h - 16, def.color, 3);
    box(ctx, 7, 11, w - 14, h - 22, '#f2f2f2', 2);
    ctx.fillStyle = '#20262f';
    ctx.fillRect(3, h / 2 - 1, w - 6, 2);
  },
  slide(ctx, w, h, def) {
    box(ctx, 6, 4, w - 12, 18, '#8f9bb0', 3);
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(w / 2, 16);
    ctx.bezierCurveTo(w - 6, h * 0.35, 6, h * 0.6, w / 2, h - 22);
    ctx.stroke();
    disc(ctx, w / 2, h - 16, 13, '#9fd0f0');
  },
  pool(ctx, w, h, def) {
    box(ctx, 3, 3, w - 6, h - 6, '#e9dcc0', 10);
    box(ctx, 8, 8, w - 16, h - 16, def.color, 8);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    for (let y = 22; y < h - 14; y += 16) {
      ctx.beginPath();
      ctx.moveTo(14, y);
      ctx.quadraticCurveTo(w / 2, y - 8, w - 14, y);
      ctx.stroke();
    }
  },
  carousel(ctx, w, h, def) {
    disc(ctx, w / 2 + 2, h / 2 + 3, w / 2 - 5, 'rgba(0,0,0,0.2)');
    disc(ctx, w / 2, h / 2, w / 2 - 5, '#f1e3c6');
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? def.color : '#f2f2f2';
      ctx.beginPath();
      ctx.moveTo(w / 2, h / 2);
      ctx.arc(w / 2, h / 2, w / 2 - 9, (i * Math.PI) / 4, ((i + 1) * Math.PI) / 4);
      ctx.fill();
    }
    disc(ctx, w / 2, h / 2, 6, '#f2b84b');
  },
  bumper(ctx, w, h, def) {
    box(ctx, 3, 3, w - 6, h - 6, '#3d4450', 6);
    box(ctx, 7, 7, w - 14, h - 14, '#55606b', 4);
    const cars = [def.color, '#d9534f', '#5aa9e6', '#7cc576', '#b07cc6'];
    cars.forEach((c, i) => box(ctx, 16 + ((i * 37) % (w - 44)), 14 + ((i * 23) % (h - 40)), 16, 11, c, 4));
  },
  arcade(ctx, w, h, def) {
    base(ctx, w, h, def);
    box(ctx, 7, 6, w - 14, 11, '#20262f', 2);
    box(ctx, 9, 8, w - 18, 7, '#7fe3b0', 1);
    disc(ctx, 11, 23, 2.5, '#d9534f');
    disc(ctx, w - 11, 23, 2.5, '#f2b84b');
  },
  stall(ctx, w, h, def) {
    box(ctx, 3, 4, w - 6, h - 8, '#a97c50', 2);
    for (let x = 3; x < w - 3; x += 8) {
      ctx.fillStyle = (x / 8) % 2 < 1 ? def.color : '#f2f2f2';
      ctx.fillRect(x, 4, Math.min(8, w - 3 - x), 10);
    }
  },
  fountain(ctx, w, h, def) {
    disc(ctx, w / 2, h / 2, w / 2 - 4, '#b9bcc2');
    disc(ctx, w / 2, h / 2, w / 2 - 9, def.color);
    disc(ctx, w / 2, h / 2, 7, '#b9bcc2');
    disc(ctx, w / 2, h / 2, 3, '#e9f4fb');
  },
};
Object.assign(PAINTERS, MORE);

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
  } else if (defId === 'floor_grass') {
    for (let i = 0; i < 3; i++) ctx.fillRect(px + ((tx * 13 + ty * 7 + i * 11) % 28), py + ((tx * 5 + ty * 17 + i * 9) % 28), 3, 2);
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
