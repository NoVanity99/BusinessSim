import type Phaser from 'phaser';
import { ATLAS } from '../art/atlas';

/**
 * A small canvas showing one frame of the game's texture atlas, for use in the HTML
 * interface (furniture in the build catalogue, staff portraits).
 */
export function frameCanvas(frame: string, size = 32, crop?: { x: number; y: number; w: number; h: number }): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.className = 'thumb';
  const game = (window as unknown as { game?: Phaser.Game }).game;
  const f = game?.textures.exists(ATLAS) ? game.textures.getFrame(ATLAS, frame) : null;
  if (!f) return canvas;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const sx = f.cutX + (crop?.x ?? 0);
  const sy = f.cutY + (crop?.y ?? 0);
  const sw = crop?.w ?? f.cutWidth;
  const sh = crop?.h ?? f.cutHeight;
  // Fit inside the square, keeping the pixel aspect.
  const k = Math.min(size / sw, size / sh);
  const dw = Math.round(sw * k);
  const dh = Math.round(sh * k);
  ctx.drawImage(f.source.image as CanvasImageSource, sx, sy, sw, sh, Math.round((size - dw) / 2), Math.round((size - dh) / 2), dw, dh);
  return canvas;
}
