import { addFrame, U } from './atlas';

/**
 * Ground, street and building frames. Most are Kenney "RPG Urban Pack" tiles; roofs are
 * recoloured per neighbourhood so districts read differently from above.
 */

/** Colours of the red roof tiles in the source sheet: main, shade, highlight. */
const ROOF_SRC = ['#c2504d', '#a54240', '#dc615d'] as const;

/** Roof colour sets per building style: [main, shade, highlight]. Four variants each. */
export const ROOF_COLORS: Record<string, [string, string, string][]> = {
  house: [['#c2504d', '#a54240', '#dc615d'], ['#c77b47', '#a9673b', '#dc8652'], ['#7d8f6a', '#687a58', '#93a57f'], ['#8a7aa0', '#756689', '#a092b6']],
  brick: [['#a8614b', '#8f503d', '#c0765e'], ['#b5744f', '#9a6040', '#cb8a64'], ['#96584a', '#7e493d', '#ad6c5d'], ['#8d5243', '#7d4552', '#a36656']],
  office: [['#6f86a6', '#5c7190', '#869cbb'], ['#7a77a4', '#66638c', '#918eb9'], ['#5f7f8c', '#4f6b77', '#7696a3'], ['#8795a8', '#727f91', '#9eabbd']],
  warehouse: [['#8b9099', '#777c85', '#a0a5ae'], ['#9a938a', '#857e76', '#aea79e'], ['#7f8a8f', '#6c767b', '#959fa4'], ['#948b7d', '#7f776a', '#a89f91']],
  resort: [['#38a89d', '#2f8f86', '#4fc0b5'], ['#e0a05a', '#c5894a', '#efb673'], ['#59b6d8', '#479dbd', '#73c8e6'], ['#d9788a', '#bf6375', '#e88fa0']],
};

/** Wall colour under each roof style, for the street-facing strip. */
const FACADE: Record<string, [string, string]> = {
  house: ['#d6d4af', '#b39b7d'],
  brick: ['#c0b29a', '#836a62'],
  office: ['#beb8cd', '#7a77a4'],
  warehouse: ['#aaaeba', '#69717b'],
  resort: ['#e6eef8', '#a5abb4'],
};

export function registerWorldFrames(): void {
  const urban = (name: string, col: number, row: number): void => addFrame(name, U, U, (p) => p.tile('urban', col, row));

  urban('grass', 1, 1);
  urban('pave', 9, 1);
  urban('road', 8, 16);
  urban('lot', 1, 4);
  urban('path', 9, 4);
  urban('water', 9, 7);
  // Trees are drawn over grass so they can stand anywhere.
  addFrame('tree_0', U, U, (p) => p.tile('urban', 1, 1).tile('urban', 22, 9));
  addFrame('tree_1', U, U, (p) => p.tile('urban', 1, 1).tile('urban', 22, 10));
  addFrame('tree_2', U, U, (p) => p.tile('urban', 1, 1).tile('urban', 21, 10));

  addFrame('sand', U, U, (p) => {
    p.r(0, 0, U, U, '#e3d3a0').r(3, 4, 2, 1, '#d6c48d').r(11, 9, 2, 1, '#d6c48d').r(7, 13, 1, 1, '#f0e3b8').r(13, 2, 1, 1, '#f0e3b8');
  });
  // Lane markings: a short dash on the lane seam, for east-west and north-south roads.
  addFrame('road_dash_h', U, U, (p) => p.tile('urban', 8, 16).r(4, 15, 8, 1, '#aaa8bd'));
  addFrame('road_dash_v', U, U, (p) => p.tile('urban', 8, 16).r(15, 4, 1, 8, '#aaa8bd'));
  // Zebra crossings in both orientations.
  addFrame('cross_a', U, U, (p) => {
    p.tile('urban', 8, 16);
    for (let y = 1; y < U; y += 4) p.r(2, y, 12, 2, '#beb8cd');
  });
  addFrame('cross_b', U, U, (p) => {
    p.tile('urban', 8, 16);
    for (let x = 1; x < U; x += 4) p.r(x, 2, 2, 12, '#beb8cd');
  });
  // "For rent" board for empty lots.
  addFrame('sign_rent', U, U, (p) => {
    p.r(7, 8, 2, 7, '#8f673f').box(2, 2, 12, 8, '#ffc90e', '#8f673f').r(4, 4, 8, 1, '#8f673f').r(4, 6, 6, 1, '#8f673f');
  });

  // Roofs: a 3x4 nine-slice (edges, a ridge row, a plain row) per style and variant.
  for (const [style, variants] of Object.entries(ROOF_COLORS)) {
    variants.forEach((colors, v) => {
      const map = Object.fromEntries(ROOF_SRC.map((c, i) => [c, colors[i]]));
      for (let ry = 0; ry < 4; ry++) {
        for (let rx = 0; rx < 3; rx++) {
          addFrame(`roof_${style}${v}_${rx}${ry}`, U, U, (p) => p.tile('urban', 17 + rx, ry).recolor(0, 0, U, U, map));
        }
      }
    });
    const [wall, trim] = FACADE[style];
    // Street-facing wall pieces: plain, with a window, and with a door.
    addFrame(`facade_${style}`, U, U, (p) => p.r(0, 0, U, U, wall).r(0, 0, U, 1, trim).r(0, 15, U, 1, trim));
    addFrame(`facade_${style}_win`, U, U, (p) => p.r(0, 0, U, U, wall).r(0, 0, U, 1, trim).r(0, 15, U, 1, trim).tile('urban', 13, 16));
    addFrame(`facade_${style}_door`, U, U, (p) => p.r(0, 0, U, U, wall).r(0, 0, U, 1, trim).tile('urban', 13, 10));
  }
}
