import Phaser from 'phaser';
import indoorUrl from '../../art-src/kenney/roguelike-indoors/roguelikeIndoor_transparent.png';
import urbanUrl from '../../art-src/kenney/rpg-urban-pack/tilemap_packed.png';

/**
 * The texture atlas. Every piece of world art lives in ONE texture so the renderer can
 * batch it: tiles cut from the Kenney sheets (see CREDITS.md), recoloured variants of
 * them, and sprites painted in code in the same 16-pixel style.
 *
 * Art is authored at 16 px per tile and drawn at 2x (32 px tiles) with nearest-neighbour
 * filtering. To replace a sprite with hand-made art, draw over its frame: load an image
 * and blit it in a painter registered under the same name.
 */
export const ATLAS = 'atlas';
/** Source pixels per tile. */
export const U = 16;
/** World pixels per source pixel. */
export const SCALE = 2;
const SIZE = 2048;

const SHEETS = {
  urban: { key: 'k_urban', url: urbanUrl, pitch: 16 },
  indoor: { key: 'k_indoor', url: indoorUrl, pitch: 17 },
} as const;
type SheetId = keyof typeof SHEETS;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Pixel-art drawing helpers bound to one frame's top-left corner. All units are source pixels. */
export class Pix {
  constructor(
    readonly ctx: CanvasRenderingContext2D,
    private readonly ox: number,
    private readonly oy: number,
    private readonly sheets: Record<SheetId, HTMLImageElement | HTMLCanvasElement>,
  ) {}

  /** Filled rectangle. */
  r(x: number, y: number, w: number, h: number, color: string): this {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(this.ox + Math.round(x), this.oy + Math.round(y), Math.round(w), Math.round(h));
    return this;
  }

  /** Filled rectangle with a 1 px outline. */
  box(x: number, y: number, w: number, h: number, fill: string, line: string): this {
    return this.r(x, y, w, h, line).r(x + 1, y + 1, w - 2, h - 2, fill);
  }

  /** Box with its corner pixels knocked out, the way the Kenney tiles round things off. */
  rbox(x: number, y: number, w: number, h: number, fill: string, line: string): this {
    this.box(x, y, w, h, fill, line);
    for (const [cx, cy] of [[x, y], [x + w - 1, y], [x, y + h - 1], [x + w - 1, y + h - 1]]) this.clear(cx, cy, 1, 1);
    return this;
  }

  clear(x: number, y: number, w: number, h: number): this {
    this.ctx.clearRect(this.ox + Math.round(x), this.oy + Math.round(y), Math.round(w), Math.round(h));
    return this;
  }

  /** Pixel-stepped filled circle. */
  disc(cx: number, cy: number, radius: number, color: string): this {
    for (let y = -radius; y <= radius; y++) {
      const half = Math.floor(Math.sqrt(radius * radius - y * y) + 0.35);
      this.r(cx - half, cy + y, half * 2 + 1, 1, color);
    }
    return this;
  }

  /** Copy tiles from a source sheet. Coordinates are tile column and row. */
  tile(sheet: SheetId, col: number, row: number, dx = 0, dy = 0, wTiles = 1, hTiles = 1): this {
    const pitch = SHEETS[sheet].pitch;
    for (let ty = 0; ty < hTiles; ty++) {
      for (let tx = 0; tx < wTiles; tx++) {
        this.ctx.drawImage(this.sheets[sheet], (col + tx) * pitch, (row + ty) * pitch, U, U, this.ox + dx + tx * U, this.oy + dy + ty * U, U, U);
      }
    }
    return this;
  }

  /** Replace exact colours inside a region, for recoloured variants of a tile. */
  recolor(x: number, y: number, w: number, h: number, map: Record<string, string>): this {
    const img = this.ctx.getImageData(this.ox + x, this.oy + y, w, h);
    const d = img.data;
    const table = new Map<number, [number, number, number]>();
    for (const [from, to] of Object.entries(map)) {
      const f = parseInt(from.slice(1), 16);
      const t = parseInt(to.slice(1), 16);
      table.set(f, [t >> 16, (t >> 8) & 255, t & 255]);
    }
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const to = table.get((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      if (to) [d[i], d[i + 1], d[i + 2]] = to;
    }
    this.ctx.putImageData(img, this.ox + x, this.oy + y);
    return this;
  }
}

export type Painter = (p: Pix, w: number, h: number) => void;

const frames = new Map<string, Rect>();
let canvas: HTMLCanvasElement | null = null;
let sheetImages: Record<SheetId, HTMLImageElement | HTMLCanvasElement> | null = null;
// Simple shelf packer: fill a row left to right, then start the next row below the tallest frame.
let cursorX = 0;
let cursorY = 0;
let rowH = 0;

/** Queue the source sheets. Call from a scene's preload(). */
export function preloadAtlasSources(scene: Phaser.Scene): void {
  for (const s of Object.values(SHEETS)) if (!scene.textures.exists(s.key)) scene.load.image(s.key, s.url);
}

/** Start an empty atlas. The sources must have finished loading. */
export function beginAtlas(scene: Phaser.Scene): void {
  frames.clear();
  cursorX = cursorY = rowH = 0;
  if (scene.textures.exists(ATLAS)) scene.textures.remove(ATLAS);
  const tex = scene.textures.createCanvas(ATLAS, SIZE, SIZE)!;
  canvas = tex.getSourceImage() as HTMLCanvasElement;
  tex.getContext().imageSmoothingEnabled = false;
  sheetImages = {
    urban: scene.textures.get(SHEETS.urban.key).getSourceImage() as HTMLImageElement,
    indoor: scene.textures.get(SHEETS.indoor.key).getSourceImage() as HTMLImageElement,
  };
}

/** Paint one frame into the atlas. `w` and `h` are source pixels. Re-adding a name is ignored. */
export function addFrame(name: string, w: number, h: number, paint: Painter): void {
  if (!canvas || !sheetImages) throw new Error('beginAtlas() has not run');
  if (frames.has(name)) return;
  // One transparent pixel of padding stops neighbours bleeding into each other.
  if (cursorX + w + 1 > SIZE) {
    cursorX = 0;
    cursorY += rowH + 1;
    rowH = 0;
  }
  if (cursorY + h + 1 > SIZE) throw new Error(`Texture atlas is full (adding ${name})`);
  const rect = { x: cursorX, y: cursorY, w, h };
  frames.set(name, rect);
  paint(new Pix(canvas.getContext('2d')!, rect.x, rect.y, sheetImages), w, h);
  cursorX += w + 1;
  rowH = Math.max(rowH, h);
}

/** Make another name point at an existing frame. */
export function aliasFrame(name: string, existing: string): void {
  const r = frames.get(existing);
  if (r && !frames.has(name)) frames.set(name, r);
}

/** Register every frame with Phaser. Call once after all frames are added. */
export function finishAtlas(scene: Phaser.Scene): void {
  const tex = scene.textures.get(ATLAS) as Phaser.Textures.CanvasTexture;
  for (const [name, r] of frames) if (!tex.has(name)) tex.add(name, 0, r.x, r.y, r.w, r.h);
  tex.refresh();
}

export const hasFrame = (name: string): boolean => frames.has(name);
export const frameRect = (name: string): Rect | undefined => frames.get(name);
export const atlasUsage = (): { frames: number; filled: number } => ({ frames: frames.size, filled: (cursorY + rowH) / SIZE });

/** Draw an atlas frame onto another canvas at world scale (used to bake the static city). */
export function blit(ctx: CanvasRenderingContext2D, name: string, dx: number, dy: number): void {
  const r = frames.get(name);
  if (!r || !canvas) return;
  ctx.drawImage(canvas, r.x, r.y, r.w, r.h, dx, dy, r.w * SCALE, r.h * SCALE);
}
