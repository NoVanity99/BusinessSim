import { addFrame, U } from './atlas';
import { ageOfLook, LOOK_COUNT, type AgeGroup } from './looks';

/**
 * People and vehicles. Characters start from the six sets in the Kenney "RPG Urban Pack"
 * and are recoloured (skin, hair, top, trousers) into many distinct looks; vehicles are
 * the pack's cars in several colours plus a van and a bus painted to match.
 *
 * Frame names: `chr:<look>:<dir>:<frame>`, `car:<kind>:<dir>`, `emote:<name>`.
 */
export type Dir = 'left' | 'down' | 'up' | 'right';
const DIR_COL: Record<Dir, number> = { left: 23, down: 24, up: 25, right: 26 };

type Pair = [string, string];

/** Skin tones as [light, shade, highlight, deep], replacing the pack's light skin. */
const SKIN_SRC = ['#ffc999', '#f1b089', '#ffc8a1', '#e29779'];
const SKINS: string[][] = [
  SKIN_SRC,
  ['#f0c08a', '#d9a36c', '#f5cc9c', '#c48a55'],
  ['#d19a66', '#b57d4b', '#dba877', '#9c6638'],
  ['#a86f45', '#8c5733', '#b57d52', '#744525'],
  ['#7a4a2b', '#633a20', '#875636', '#4f2d17'],
];
const HAIRS: Pair[] = [['#dc8652', '#c57652'], ['#f2d16b', '#d9b04a'], ['#8f563b', '#6e4230'], ['#373733', '#50504a'], ['#c2504d', '#a54240'], ['#beb8cd', '#a09cca'], ['#e6eef8', '#aaa8bd']];
const TOPS: Pair[] = [['#42a379', '#369069'], ['#c2504d', '#a54240'], ['#59b6d8', '#3f93b3'], ['#f2b84b', '#d99a2e'], ['#a09cca', '#7a77a4'], ['#e6eef8', '#aaa8bd'], ['#5c6278', '#4a4f63'], ['#e87ba4', '#c95f88'], ['#c77b47', '#a9673b']];
const BOTTOMS: Pair[] = [['#d6d4aa', '#c5b993'], ['#a09cca', '#7a77a4'], ['#60605a', '#54544e'], ['#5c6278', '#4a4f63'], ['#8f673f', '#725839'], ['#aaa8bd', '#898ca6']];

/** Which colours of each source character are hair, top and trousers (skin is shared). */
const BASES: { hair?: Pair; top: Pair; bottom: Pair; darkSkin?: boolean }[] = [
  { hair: ['#dc8652', '#c57652'], top: ['#42a379', '#369069'], bottom: ['#d6d4aa', '#c5b993'] },
  { hair: ['#dc8652', '#c57652'], top: ['#c2504d', '#a54240'], bottom: ['#a09cca', '#7a77a4'] },
  { hair: ['#a09cca', '#7a77a4'], top: ['#42a379', '#369069'], bottom: ['#5c6278', '#5c6278'] },
  { top: ['#918eb9', '#7a77a4'], bottom: ['#60605a', '#373733'], darkSkin: true },
  { top: ['#aaa8bd', '#898ca6'], bottom: ['#60605a', '#54544e'] },
  { hair: ['#373733', '#50504a'], top: ['#c77b47', '#a9673b'], bottom: ['#aaa8bd', '#aaa8bd'] },
];

export interface Look {
  base: number;
  age: AgeGroup;
  /** Drawn size relative to an average adult. */
  scale: number;
}

export const LOOKS: Look[] = [];

export const charFrame = (look: number, dir: Dir, frame: number): string => `chr:${((look % LOOK_COUNT) + LOOK_COUNT) % LOOK_COUNT}:${dir}:${frame % 3}`;

export const CAR_KINDS = ['red', 'blue', 'green', 'white', 'grey', 'taxi'] as const;
const CAR_SRC = ['#c2504d', '#a54240', '#dc615d'];
const CAR_COLORS: Record<string, string[] | null> = {
  red: null,
  blue: ['#59b6d8', '#3f93b3', '#8fd3ea'],
  green: ['#4ba86d', '#307e4d', '#5eb780'],
  white: ['#e6eef8', '#aaa8bd', '#ffffff'],
  grey: ['#838790', '#5c6278', '#aaaeba'],
  taxi: null,
};
export const carFrame = (kind: string, dir: Dir): string => `car:${kind}:${dir}`;

/** Deterministic pick so the same look index always produces the same person. */
const pick = <T,>(list: T[], seed: number, salt: number): T => list[Math.abs((seed * 2654435761 + salt * 40503) >>> 0) % list.length];

export function registerActorFrames(): void {
  LOOKS.length = 0;
  for (let look = 0; look < LOOK_COUNT; look++) {
    const base = look % BASES.length;
    const src = BASES[base];
    const age: AgeGroup = ageOfLook(look);
    const hair = age === 'senior' ? pick(HAIRS.slice(5), look, 1) : pick(HAIRS.slice(0, 5), look, 1);
    const map: Record<string, string> = {};
    const swap = (from: string[], to: string[]): void => from.forEach((c, i) => c !== to[i] && (map[c] = to[i]));
    // The first six looks are the untouched originals; the rest are recoloured.
    if (look >= BASES.length) {
      if (!src.darkSkin) swap(SKIN_SRC, pick(SKINS, look, 2));
      if (src.hair) swap(src.hair, hair);
      swap(src.top, pick(TOPS, look, 3));
      swap(src.bottom, pick(BOTTOMS, look, 4));
    } else if (age === 'senior' && src.hair) swap(src.hair, hair);
    LOOKS.push({ base, age, scale: age === 'child' ? 0.72 : age === 'senior' ? 0.95 : 0.96 + (look % 5) * 0.03 });

    for (const dir of Object.keys(DIR_COL) as Dir[]) {
      for (let f = 0; f < 3; f++) {
        addFrame(charFrame(look, dir, f), U, U, (p) => {
          // A soft shadow under the feet is part of the sprite, so it costs nothing to draw.
          p.ctx.globalAlpha = 0.25;
          p.r(4, 14, 8, 2, '#000000').r(5, 13, 6, 1, '#000000');
          p.ctx.globalAlpha = 1;
          p.tile('urban', DIR_COL[dir], base * 3 + f);
          if (Object.keys(map).length) p.recolor(0, 0, U, U, map);
        });
      }
    }
  }

  // Cars: side views are two tiles wide and two tall; front and back are one wide.
  for (const kind of CAR_KINDS) {
    const row = kind === 'taxi' ? 14 : 16;
    const to = CAR_COLORS[kind];
    const recolor = to ? Object.fromEntries(CAR_SRC.map((c, i) => [c, to[i]])) : null;
    const add = (dir: Dir, col: number, wTiles: number): void =>
      addFrame(carFrame(kind, dir), wTiles * U, 2 * U, (p) => {
        p.tile('urban', col, row, 0, 0, wTiles, 2);
        if (recolor) p.recolor(0, 0, wTiles * U, 2 * U, recolor);
      });
    add('left', 15, 2);
    add('down', 17, 1);
    add('right', 18, 2);
    add('up', 20, 1);
  }

  // Delivery van and city bus, painted to match the pack's cars: boxy body, windows, wheels.
  const boxy = (kind: string, tiles: number, body: string, hi: string, line: string, stripe: string): void => {
    for (const dir of ['left', 'right', 'up', 'down'] as Dir[]) {
      const side = dir === 'left' || dir === 'right';
      addFrame(carFrame(kind, dir), side ? tiles * U : U, 2 * U, (p, w) => {
        if (side) {
          p.rbox(0, 9, w, 20, body, line).r(1, 10, w - 2, 3, hi);
          // The bus has a row of passenger windows; the van only a cab window.
          if (tiles > 2) for (let x = 3; x < w - 6; x += 7) p.box(x, 14, 6, 6, '#bfe3f0', '#5c6278');
          p.r(1, 22, w - 2, 2, stripe);
          p.box(dir === 'left' ? 1 : w - 7, 14, 6, 7, '#e6f6fb', '#5c6278');
          for (const x of [4, w - 10]) p.disc(x + 2, 28, 3, '#373733').disc(x + 2, 28, 1, '#aaa8bd');
        } else {
          const len = tiles > 2 ? 28 : 24;
          p.rbox(1, 30 - len, 14, len, body, line).r(3, 32 - len, 10, len - 8, hi).r(3, 30 - len + Math.floor(len / 2), 10, 2, stripe);
          if (dir === 'down') p.box(2, 23, 12, 5, '#bfe3f0', '#5c6278');
          else p.box(2, 31 - len, 12, 4, '#bfe3f0', '#5c6278');
        }
      });
    }
  };
  boxy('van', 2, '#e6eef8', '#ffffff', '#5c6278', '#c2504d');
  boxy('bus', 3, '#f2b84b', '#ffd98a', '#8f673f', '#c2504d');

  // Little icons that pop up over people's heads.
  const emote = (name: string, draw: (p: import('./atlas').Pix) => void): void => addFrame(`emote:${name}`, 9, 9, (p) => {
    p.rbox(0, 0, 9, 9, '#ffffff', '#5c6278');
    draw(p);
  });
  emote('happy', (p) => p.r(2, 2, 2, 2, '#c2504d').r(5, 2, 2, 2, '#c2504d').r(2, 4, 5, 1, '#c2504d').r(3, 5, 3, 1, '#c2504d').r(4, 6, 1, 1, '#c2504d'));
  emote('angry', (p) => p.r(2, 2, 2, 1, '#c2504d').r(5, 2, 2, 1, '#c2504d').r(3, 3, 1, 1, '#c2504d').r(5, 3, 1, 1, '#c2504d').r(2, 6, 5, 1, '#c2504d').r(3, 5, 3, 1, '#c2504d'));
  emote('money', (p) => p.r(4, 1, 1, 7, '#307e4d').r(3, 2, 3, 1, '#4ba86d').r(2, 3, 2, 1, '#4ba86d').r(3, 4, 3, 1, '#4ba86d').r(5, 5, 2, 1, '#4ba86d').r(3, 6, 3, 1, '#4ba86d'));
  emote('wait', (p) => p.r(2, 4, 1, 1, '#5c6278').r(4, 4, 1, 1, '#5c6278').r(6, 4, 1, 1, '#5c6278'));
  emote('question', (p) => p.r(3, 2, 3, 1, '#59b6d8').r(5, 3, 1, 1, '#59b6d8').r(4, 4, 1, 1, '#59b6d8').r(4, 6, 1, 1, '#59b6d8'));
  emote('food', (p) => p.r(2, 3, 5, 1, '#c77b47').r(2, 4, 5, 1, '#4ba86d').r(2, 5, 5, 1, '#8f563b').r(2, 6, 5, 1, '#c77b47'));
  emote('bag', (p) => p.box(2, 3, 5, 5, '#c8a480', '#8f673f').r(3, 2, 3, 1, '#8f673f'));

  // Soft blob shadow under people, and tiny birds.
  addFrame('shadow', 10, 4, (p) => {
    p.ctx.globalAlpha = 0.28;
    p.r(1, 0, 8, 4, '#000000').r(0, 1, 10, 2, '#000000');
    p.ctx.globalAlpha = 1;
  });
  addFrame('bird:0', 7, 5, (p) => p.r(0, 1, 2, 1, '#373733').r(2, 2, 3, 1, '#373733').r(5, 1, 2, 1, '#373733'));
  addFrame('bird:1', 7, 5, (p) => p.r(0, 3, 2, 1, '#373733').r(2, 2, 3, 1, '#373733').r(5, 3, 2, 1, '#373733'));
}
