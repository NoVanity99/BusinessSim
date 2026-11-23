import { addFrame, U } from './atlas';

/**
 * People and vehicles, cut from the Kenney "RPG Urban Pack".
 * Frame names: `chr:<base>:<dir>:<frame>` and `car:<colour>:<dir>`.
 */

/** Character sets in the sheet, top to bottom. Each has idle + two walk frames in four directions. */
export const CHARACTER_BASES = 6;
export type Dir = 'left' | 'down' | 'up' | 'right';
const DIR_COL: Record<Dir, number> = { left: 23, down: 24, up: 25, right: 26 };

export const charFrame = (base: number, dir: Dir, frame: number): string => `chr:${base % CHARACTER_BASES}:${dir}:${frame % 3}`;

/** Body colours of the red car in the sheet, and the sets it is recoloured to. */
const CAR_SRC = ['#c2504d', '#a54240', '#dc615d'] as const;
export const CAR_COLORS: Record<string, [string, string, string] | null> = {
  red: null,
  blue: ['#59b6d8', '#3f93b3', '#8fd3ea'],
  green: ['#4ba86d', '#307e4d', '#5eb780'],
  white: ['#e6eef8', '#aaa8bd', '#ffffff'],
  grey: ['#838790', '#5c6278', '#aaaeba'],
  taxi: null,
};
export const CAR_KINDS = Object.keys(CAR_COLORS);

export const carFrame = (color: string, dir: Dir): string => `car:${color}:${dir}`;

export function registerActorFrames(): void {
  for (let base = 0; base < CHARACTER_BASES; base++) {
    for (const dir of Object.keys(DIR_COL) as Dir[]) {
      for (let f = 0; f < 3; f++) addFrame(charFrame(base, dir, f), U, U, (p) => p.tile('urban', DIR_COL[dir], base * 3 + f));
    }
  }
  // Cars: side views are two tiles wide and two tall; front and back are one wide.
  for (const [color, map] of Object.entries(CAR_COLORS)) {
    const row = color === 'taxi' ? 14 : 16;
    const recolor = map ? Object.fromEntries(CAR_SRC.map((c, i) => [c, map[i]])) : null;
    const add = (dir: Dir, col: number, wTiles: number): void =>
      addFrame(carFrame(color, dir), wTiles * U, 2 * U, (p) => {
        p.tile('urban', col, row, 0, 0, wTiles, 2);
        if (recolor) p.recolor(0, 0, wTiles * U, 2 * U, recolor);
      });
    add('left', 15, 2);
    add('down', 17, 1);
    add('right', 18, 2);
    add('up', 20, 1);
  }
}
