import { FURNITURE, type FurnitureDef } from '../data';
import { addFrame, type Pix, U } from './atlas';

/**
 * Furniture, machines and structure, painted in code at 16 px per tile to sit alongside
 * the Kenney tiles (same outline weight, same flat shading, colours sampled from the packs).
 *
 * Each sprite is drawn once per facing (0 south, 1 west, 2 north, 3 east) into a frame the
 * size of its rotated footprint, plus extra frames for anything animated.
 * Frame names: `furn:<furniture id>:<rotation>:<frame>`.
 */

// Colours sampled from the two source packs.
const C = {
  wood: '#c8a480', woodMid: '#b98b5e', woodDark: '#8f673f', woodDeep: '#725839',
  steel: '#c2c2c2', steelHi: '#dfdfdf', steelMid: '#999999', steelDark: '#757575',
  iron: '#5c5c5c', ironDark: '#494949',
  line: '#5c6278', lilac: '#a09cca', lilacDark: '#7a77a4', lilacHi: '#beb8cd',
  white: '#e6eef8', cream: '#e6dabf', glass: '#bfe3f0', glassHi: '#e6f6fb', water: '#59b6d8', waterHi: '#8fd3ea',
  red: '#c2504d', redDark: '#a54240', orange: '#c66527', orangeHi: '#df9131', yellow: '#ffc90e',
  green: '#4ba86d', greenDark: '#307e4d', greenHi: '#5eb780', teal: '#30a19b',
  black: '#373733', screen: '#7fe3b0',
};

type Painter = (p: Pix, w: number, h: number, rot: number, frame: number, def: FurnitureDef) => void;

/**
 * A cabinet seen from above and slightly in front: outlined body, top surface, and a
 * darker strip on the side it faces so its front is readable at a glance.
 * Returns the rectangle of the top surface, for details to be drawn onto.
 */
function cab(p: Pix, x: number, y: number, w: number, h: number, top: string, front: string, line: string, rot: number): { x: number; y: number; w: number; h: number } {
  p.rbox(x, y, w, h, top, line);
  const t = { x: x + 1, y: y + 1, w: w - 2, h: h - 2 };
  if (rot === 0) {
    p.r(x + 1, y + h - 5, w - 2, 4, front).r(x + 1, y + h - 5, w - 2, 1, line);
    t.h -= 5;
  } else if (rot === 2) {
    p.r(x + 1, y + 1, w - 2, 2, front);
    t.y += 2;
    t.h -= 2;
  } else if (rot === 1) {
    p.r(x + 1, y + 1, 3, h - 2, front).r(x + 4, y + 1, 1, h - 2, line);
    t.x += 4;
    t.w -= 4;
  } else {
    p.r(x + w - 4, y + 1, 3, h - 2, front).r(x + w - 5, y + 1, 1, h - 2, line);
    t.w -= 4;
  }
  return t;
}

/** Soft ground shadow so objects sit on the floor instead of floating. */
function shadow(p: Pix, w: number, h: number): void {
  p.ctx.globalAlpha = 0.22;
  p.r(2, h - 2, w - 3, 2, '#000000');
  p.ctx.globalAlpha = 1;
}

const PAINTERS: Record<string, Painter> = {
  shelf(p, w, h, rot) {
    const t = cab(p, 0, 0, w, h, C.woodMid, C.wood, C.woodDark, rot);
    // The recess where goods sit.
    p.r(t.x + 1, t.y + 1, t.w - 2, t.h - 2, C.woodDeep);
  },
  rack(p, w, h, rot, _f, def) {
    const purple = def.color !== '#8c8f96';
    const t = cab(p, 0, 0, w, h, purple ? C.lilac : C.steel, purple ? C.lilacHi : C.steelHi, purple ? C.line : C.steelDark, rot);
    p.r(t.x + 1, t.y + 1, t.w - 2, t.h - 2, purple ? C.lilacDark : C.steelMid);
  },
  fridge(p, w, h, rot) {
    const t = cab(p, 0, 0, w, h, C.steelHi, C.white, C.steelDark, rot);
    p.r(t.x + 1, t.y + 1, t.w - 2, t.h - 2, C.glass);
    // Door handle on the facing side.
    if (rot === 0) p.r(Math.floor(w / 2) - 1, h - 4, 2, 2, C.steelDark);
  },
  freezer(p, w, h, rot) {
    const t = cab(p, 0, 0, w, h, C.white, C.steelHi, C.steelDark, rot);
    p.r(t.x + 1, t.y + 1, t.w - 2, t.h - 2, C.glass).r(t.x + 1, t.y + 1, t.w - 2, 1, C.glassHi);
  },
  case(p, w, h, rot, _f, def) {
    const t = cab(p, 0, 0, w, h, C.wood, C.woodMid, C.woodDark, rot);
    p.r(t.x + 1, t.y + 1, t.w - 2, t.h - 2, C.glass).r(t.x + 2, t.y + 1, t.w - 4, 1, C.glassHi);
    if (def.kind === 'decor') {
      // A pastry display shows its wares all the time.
      const colors = [C.orangeHi, C.woodMid, C.cream, C.orange];
      for (let i = 0, x = t.x + 2; x + 3 <= t.x + t.w - 1; x += 4, i++) p.r(x, t.y + 3, 3, 2, colors[i % 4]).r(x, t.y + 6, 3, 2, colors[(i + 2) % 4]);
    }
  },
  register(p, w, h, rot) {
    const t = cab(p, 0, 0, w, h, C.steel, C.woodMid, C.steelDark, rot);
    // Till with a lit screen, and a strip of counter beside it.
    p.box(t.x + 2, t.y + 1, 7, 6, C.iron, C.ironDark).r(t.x + 4, t.y + 2, 3, 2, C.screen).r(t.x + 3, t.y + 5, 5, 1, C.steelHi);
    p.r(t.x + 10, t.y + 2, Math.max(0, t.w - 11), 2, C.steelMid);
  },
  counter(p, w, h, rot) {
    const t = cab(p, 0, 0, w, h, C.cream, C.red, C.redDark, rot);
    p.box(t.x + 2, t.y + 1, 7, 6, C.iron, C.ironDark).r(t.x + 4, t.y + 2, 3, 2, C.screen);
    // Tray waiting for an order.
    p.r(t.x + 10, t.y + 2, Math.max(0, t.w - 11), 4, C.woodMid);
  },
  storage(p, w, h, rot) {
    const t = cab(p, 0, 0, w, h, C.steelMid, C.steelDark, C.iron, rot);
    // Cardboard boxes with tape.
    for (let x = t.x + 1; x + 6 <= t.x + t.w; x += 7) {
      p.box(x, t.y + 1, 6, Math.max(4, t.h - 2), C.wood, C.woodDark).r(x + 2, t.y + 1, 2, Math.max(4, t.h - 2), C.cream);
    }
  },
  plant(p, w, h) {
    shadow(p, w, h);
    p.rbox(4, 9, 8, 6, C.orange, C.woodDeep).r(5, 10, 6, 1, C.orangeHi);
    p.disc(8, 6, 5, C.greenDark).disc(6, 5, 3, C.green).disc(10, 6, 3, C.green).disc(8, 3, 2, C.greenHi);
  },
  lamp(p, w, h) {
    shadow(p, w, h);
    p.r(7, 6, 2, 8, C.iron).r(5, 13, 6, 2, C.ironDark);
    p.rbox(3, 1, 10, 6, C.yellow, C.orangeHi).r(5, 2, 6, 2, '#fff4c9');
  },
  rug(p, w, h, _r, _f, def) {
    p.r(1, 2, w - 2, h - 4, def.color).r(2, 3, w - 4, 1, C.cream).r(2, h - 4, w - 4, 1, C.cream);
    for (let x = 1; x < w - 1; x += 2) p.r(x, 1, 1, 1, def.color).r(x, h - 2, 1, 1, def.color);
  },
  bin(p) {
    p.tile('urban', 9, 10);
  },
  washer(p, w, h, rot, frame) {
    const t = cab(p, 0, 0, w, h, C.white, C.steelHi, C.steelDark, rot);
    const cx = t.x + Math.floor(t.w / 2);
    const cy = t.y + Math.floor(t.h / 2) + 1;
    p.r(t.x + 1, t.y, 3, 1, C.water).r(t.x + t.w - 3, t.y, 2, 1, C.red);
    p.disc(cx, cy, 4, C.line).disc(cx, cy, 3, C.water);
    // A highlight that goes round as the drum turns.
    const spin = [[-1, -2], [2, -1], [1, 2], [-2, 1]][frame % 4];
    p.r(cx + spin[0], cy + spin[1], 1, 1, C.glassHi).r(cx - spin[0], cy - spin[1], 1, 1, C.waterHi);
  },
  dryer(p, w, h, rot, frame) {
    const t = cab(p, 0, 0, w, h, C.cream, C.wood, C.woodDark, rot);
    const cx = t.x + Math.floor(t.w / 2);
    const cy = t.y + Math.floor(t.h / 2) + 1;
    p.r(t.x + 1, t.y, 3, 1, C.orange);
    p.disc(cx, cy, 4, C.line).disc(cx, cy, 3, C.ironDark);
    const spin = [[-1, -2], [2, -1], [1, 2], [-2, 1]][frame % 4];
    p.r(cx + spin[0], cy + spin[1], 2, 1, C.orangeHi).r(cx - spin[0], cy - spin[1], 1, 1, C.cream);
  },
  bench(p, w, h) {
    shadow(p, w, h);
    const horizontal = w >= h;
    if (horizontal) {
      p.rbox(1, 4, w - 2, 9, C.wood, C.woodDark);
      for (let y = 6; y < 12; y += 3) p.r(2, y, w - 4, 1, C.woodMid);
      p.r(1, 2, w - 2, 3, C.woodMid).r(1, 2, w - 2, 1, C.woodDark);
    } else {
      p.rbox(4, 1, 9, h - 2, C.wood, C.woodDark);
      for (let x = 6; x < 12; x += 3) p.r(x, 2, 1, h - 4, C.woodMid);
      p.r(2, 1, 3, h - 2, C.woodMid).r(2, 1, 1, h - 2, C.woodDark);
    }
  },
  table(p, w, h, _r, _f, def) {
    shadow(p, w, h);
    const picnic = !!def.outdoor;
    const horizontal = w >= h;
    const seat = picnic ? C.woodMid : C.steel;
    const seatLine = picnic ? C.woodDark : C.steelDark;
    if (horizontal) {
      p.rbox(1, 4, 5, 8, seat, seatLine).rbox(w - 6, 4, 5, 8, seat, seatLine);
      p.rbox(6, 2, w - 12, 12, C.wood, C.woodDark).r(7, 3, w - 14, 1, C.cream);
    } else {
      p.rbox(4, 1, 8, 5, seat, seatLine).rbox(4, h - 6, 8, 5, seat, seatLine);
      p.rbox(2, 6, 12, h - 12, C.wood, C.woodDark).r(3, 7, 10, 1, C.cream);
    }
  },
  grill(p, w, h, rot) {
    const t = cab(p, 0, 0, w, h, C.steelDark, C.steelMid, C.ironDark, rot);
    p.r(t.x + 1, t.y + 1, t.w - 2, t.h - 2, C.black);
    for (let x = t.x + 2; x < t.x + t.w - 1; x += 2) p.r(x, t.y + 1, 1, t.h - 2, C.iron);
    // Burgers on the heat.
    p.r(t.x + 2, t.y + 2, 3, 2, C.woodDeep).r(t.x + 7, t.y + 4, 3, 2, C.woodDeep).r(t.x + 3, t.y + 3, 1, 1, C.red);
  },
  fryer(p, w, h, rot) {
    const t = cab(p, 0, 0, w, h, C.steel, C.steelMid, C.steelDark, rot);
    const half = Math.floor((t.w - 3) / 2);
    p.box(t.x + 1, t.y + 1, half, t.h - 2, C.yellow, C.steelDark).box(t.x + 2 + half, t.y + 1, half, t.h - 2, C.orangeHi, C.steelDark);
    p.r(t.x + 2, t.y + 2, half - 2, 1, '#fff4c9');
  },
  drinks(p, w, h, rot) {
    const t = cab(p, 0, 0, w, h, C.lilac, C.lilacHi, C.line, rot);
    [C.red, C.yellow, C.water].forEach((c, i) => p.box(t.x + 1 + i * 4, t.y + 1, 4, 5, c, C.line));
    p.r(t.x + 1, t.y + 7, t.w - 2, 2, C.lilacDark);
  },
  espresso(p, w, h, rot) {
    const t = cab(p, 0, 0, w, h, C.steel, C.steelHi, C.steelDark, rot);
    p.box(t.x + 1, t.y + 1, t.w - 2, 4, C.iron, C.ironDark).r(t.x + 3, t.y + 2, 2, 1, C.red).r(t.x + t.w - 5, t.y + 2, 2, 1, C.screen);
    // Two cups under the group heads.
    p.r(t.x + 3, t.y + 6, 3, 2, C.white).r(t.x + t.w - 6, t.y + 6, 3, 2, C.white).r(t.x + 4, t.y + 6, 1, 1, C.woodDeep).r(t.x + t.w - 5, t.y + 6, 1, 1, C.woodDeep);
  },
  oven(p, w, h, rot, frame) {
    const t = cab(p, 0, 0, w, h, C.steelDark, C.iron, C.ironDark, rot);
    // The window glows; it flickers slightly while baking.
    p.box(t.x + 1, t.y + 1, t.w - 2, t.h - 2, frame % 2 ? C.orangeHi : C.orange, C.black);
    p.r(t.x + 3, t.y + 3, t.w - 6, 1, C.yellow).r(t.x + 2, t.y, 2, 1, C.red).r(t.x + 5, t.y, 2, 1, C.steelHi);
  },
  clothesrack(p, w, h, rot) {
    // A chrome rail on two posts; hangers show as the goods drawn on top.
    const t = cab(p, 0, 0, w, h, C.steelHi, C.steel, C.steelDark, rot);
    p.r(t.x + 1, t.y + 1, t.w - 2, t.h - 2, C.cream);
    p.r(t.x, t.y, t.w, 1, C.steelDark).r(t.x, t.y, 1, t.h, C.steelMid).r(t.x + t.w - 1, t.y, 1, t.h, C.steelMid);
  },
  bookshelf(p, w, h, rot) {
    const t = cab(p, 0, 0, w, h, C.woodDark, C.woodMid, C.woodDeep, rot);
    p.r(t.x + 1, t.y + 1, t.w - 2, t.h - 2, C.woodDeep);
    // Shelf boards between the rows of spines.
    if (t.h >= 6) p.r(t.x + 1, t.y + Math.floor(t.h / 2), t.w - 2, 1, C.woodDark);
  },
  displaytable(p, w, h, rot) {
    const t = cab(p, 0, 0, w, h, C.white, C.steelHi, C.steelMid, rot);
    p.r(t.x + 1, t.y + 1, t.w - 2, t.h - 2, '#dfe7f2');
    // A lit strip along the back.
    p.r(t.x + 1, t.y, t.w - 2, 1, C.glassHi);
  },
  medshelf(p, w, h, rot) {
    const t = cab(p, 0, 0, w, h, C.white, C.steelHi, C.steelMid, rot);
    p.r(t.x + 1, t.y + 1, t.w - 2, t.h - 2, '#cfe0ea');
    // Green cross on the facing strip.
    if (rot === 0) p.r(Math.floor(w / 2) - 1, h - 4, 3, 1, C.green).r(Math.floor(w / 2), h - 5, 1, 3, C.green);
  },
  mannequin(p, w, h) {
    shadow(p, w, h);
    p.rbox(5, 12, 6, 3, C.steelMid, C.steelDark);
    p.r(7, 9, 2, 3, C.steelDark);
    p.rbox(4, 4, 8, 6, '#b07cc6', '#7a5590').r(5, 5, 6, 1, '#c79adb');
    p.disc(8, 2, 2, '#e8c9a0');
  },
  fitting(p, w, h) {
    p.rbox(1, 1, w - 2, h - 2, C.woodMid, C.woodDeep);
    // Curtain, drawn half across.
    for (let x = 3; x < w - 3; x += 2) p.r(x, 3, 1, h - 6, x % 4 === 3 ? '#b07cc6' : '#9a68b3');
    p.r(2, 2, w - 4, 1, C.steelHi);
  },
  pizzaoven(p, w, h, rot) {
    const t = cab(p, 0, 0, w, h, '#a8614b', '#8f503d', '#5c3a2e', rot);
    // Brick dome with the fire showing in its mouth.
    p.disc(t.x + Math.floor(t.w / 2), t.y + Math.floor(t.h / 2), Math.max(2, Math.floor(Math.min(t.w, t.h) / 2) - 1), '#c0765e');
    p.r(t.x + Math.floor(t.w / 2) - 2, t.y + t.h - 3, 4, 3, C.black).r(t.x + Math.floor(t.w / 2) - 1, t.y + t.h - 2, 2, 2, C.orangeHi);
  },
  pinball(p, w, h, rot, frame) {
    const t = cab(p, 0, 0, w, h, C.orange, C.orangeHi, C.woodDeep, rot);
    p.box(t.x + 1, t.y + 1, t.w - 2, t.h - 2, '#2f3b52', C.black);
    p.r(t.x + 3, t.y + 2, 1, 1, frame % 2 ? C.yellow : C.red).r(t.x + t.w - 4, t.y + 3, 1, 1, frame % 2 ? C.red : C.screen).r(t.x + Math.floor(t.w / 2), t.y + 4, 1, 1, C.steelHi);
  },
  airhockey(p, w, h) {
    shadow(p, w, h);
    p.rbox(1, 2, w - 2, h - 5, C.white, C.steelDark);
    p.r(2, 3, w - 4, h - 7, '#cfe8f5').r(Math.floor(w / 2), 3, 1, h - 7, C.red);
    p.r(4, Math.floor(h / 2) - 1, 2, 2, C.red).r(w - 6, Math.floor(h / 2) - 2, 2, 2, C.water).r(Math.floor(w / 2) + 3, Math.floor(h / 2), 1, 1, C.black);
    p.r(2, h - 3, 2, 2, C.steelDark).r(w - 4, h - 3, 2, 2, C.steelDark);
  },
  vanbay(p, w, h) {
    // A marked parking bay with the van standing in it.
    p.r(0, 0, w, h, '#8d919b').r(0, 0, w, 1, C.yellow).r(0, 0, 1, h, C.yellow).r(w - 1, 0, 1, h, C.yellow);
    for (let y = 3; y < h; y += 6) p.r(1, y, 1, 3, '#6f737d').r(w - 2, y, 1, 3, '#6f737d');
    const vw = Math.min(w, h) - 8;
    const long = Math.max(w, h) - 8;
    const along = h >= w;
    const bx = Math.floor((w - (along ? vw : long)) / 2);
    const by = Math.floor((h - (along ? long : vw)) / 2);
    p.rbox(bx, by, along ? vw : long, along ? long : vw, C.white, C.steelDark);
    if (along) p.r(bx + 2, by + 2, vw - 4, 5, C.glass).r(bx + 1, by + 9, vw - 2, 2, C.yellow).r(bx + 1, by + long - 3, 2, 1, C.red).r(bx + vw - 3, by + long - 3, 2, 1, C.red);
    else p.r(bx + 2, by + 2, 5, vw - 4, C.glass).r(bx + 9, by + 1, 2, vw - 2, C.yellow);
  },
  sewing(p, w, h, rot) {
    const t = cab(p, 0, 0, w, h, C.steel, C.steelMid, C.steelDark, rot);
    // Three machines along a bench with cloth feeding through.
    const n = Math.max(1, Math.floor(Math.max(t.w, t.h) / 14));
    for (let i = 0; i < n; i++) {
      const cx = t.w >= t.h ? t.x + 3 + i * Math.floor(t.w / n) : t.x + 1;
      const cy = t.w >= t.h ? t.y + 1 : t.y + 3 + i * Math.floor(t.h / n);
      p.rbox(cx, cy, 8, 5, C.white, C.line).r(cx + 6, cy + 1, 1, 3, C.ironDark).r(cx + 1, cy + 3, 4, 1, '#b07cc6');
    }
  },
  taps(p, w, h, rot) {
    const t = cab(p, 0, 0, w, h, C.woodDark, C.woodMid, C.woodDeep, rot);
    // Bottles along the back, three taps at the front.
    for (let x = t.x + 1, i = 0; x < t.x + t.w - 1; x += 3, i++) p.r(x, t.y, 2, 3, [C.green, C.red, C.orangeHi, C.glass][i % 4]);
    for (let x = t.x + 3; x < t.x + t.w - 2; x += Math.max(4, Math.floor(t.w / 3))) p.r(x, t.y + t.h - 3, 2, 3, C.steelHi).r(x, t.y + t.h - 4, 2, 1, C.yellow);
  },
  dancefloor(p, w, h, _rot, frame) {
    p.rbox(0, 0, w, h, '#2b2440', '#16121f');
    const cols = ['#d55181', '#3987e5', '#c98500', '#199e70', '#9085e9'];
    for (let y = 2, r = 0; y < h - 6; y += 8, r++) for (let x = 2, c = 0; x < w - 6; x += 8, c++) p.r(x, y, 6, 6, cols[(r * 2 + c + frame) % cols.length]);
  },
  djbooth(p, w, h, rot) {
    const t = cab(p, 0, 0, w, h, C.black, C.ironDark, '#101010', rot);
    p.disc(t.x + 4, t.y + Math.floor(t.h / 2), 3, C.iron).disc(t.x + t.w - 5, t.y + Math.floor(t.h / 2), 3, C.iron);
    p.r(t.x + Math.floor(t.w / 2) - 2, t.y + 1, 4, Math.max(2, t.h - 2), C.steelMid).r(t.x + Math.floor(t.w / 2) - 1, t.y + 2, 1, 1, C.red).r(t.x + Math.floor(t.w / 2) + 1, t.y + 2, 1, 1, C.screen);
  },
  treadmill(p, w, h, _rot, frame) {
    shadow(p, w, h);
    const up = h >= w;
    p.rbox(up ? 2 : 1, up ? 1 : 2, up ? w - 4 : w - 2, up ? h - 2 : h - 4, C.iron, C.ironDark);
    // The belt, with a mark that moves.
    if (up) p.r(4, 8, w - 8, h - 11, C.black).r(4, 10 + (frame % 2) * 5, w - 8, 1, C.steelMid).r(3, 2, w - 6, 4, C.steelHi).r(5, 3, w - 10, 2, C.screen);
    else p.r(8, 4, w - 11, h - 8, C.black).r(10 + (frame % 2) * 5, 4, 1, h - 8, C.steelMid).r(2, 3, 4, h - 6, C.steelHi);
  },
  weights(p, w, h) {
    shadow(p, w, h);
    p.rbox(3, 4, w - 6, h - 8, C.red, C.redDark);
    p.r(1, Math.floor(h / 2) - 1, w - 2, 2, C.steelHi);
    p.r(1, Math.floor(h / 2) - 4, 3, 8, C.black).r(w - 4, Math.floor(h / 2) - 4, 3, 8, C.black);
  },
  studio(p, w, h) {
    p.rbox(0, 0, w, h, C.woodMid, C.woodDark).r(1, 1, w - 2, 2, C.glassHi);
    for (let y = 6, r = 0; y < h - 5; y += 10, r++) for (let x = 4; x < w - 8; x += 14) p.rbox(x, y, 9, 5, r % 2 ? C.teal : '#b07cc6', C.line);
  },
  hotelbed(p, w, h) {
    p.rbox(0, 0, w, h, C.cream, C.woodDark);
    p.rbox(4, 3, w - 8, h - 8, C.white, C.steelMid).r(5, 4, w - 10, 6, '#f6f6f6').r(5, 12, w - 10, h - 18, '#8e2f4a').r(5, 12, w - 10, 2, '#b04a66');
    p.r(2, 4, 2, 4, C.woodDark).r(w - 4, 4, 2, 4, C.woodDark).r(w - 4, 3, 2, 1, C.yellow);
  },
  cinema(p, w, h, _rot, frame) {
    p.rbox(0, 0, w, h, '#3a2630', '#1f141a');
    // The screen along the back wall, flickering, and rows of seats.
    p.box(4, 2, w - 8, 9, frame % 2 ? '#dfe7f2' : '#bcd0e6', C.black).r(8, 4, w - 20, 3, frame % 2 ? '#8fb3d9' : '#e6c58a');
    for (let y = 18; y < h - 6; y += 9) for (let x = 5; x < w - 8; x += 9) p.rbox(x, y, 7, 6, C.red, C.redDark);
  },
  carstand(p, w, h) {
    // A polished floor plate; the car itself is drawn as the stock on it.
    p.rbox(0, 0, w, h, '#dfe7f2', C.steelMid).r(2, 2, w - 4, 1, C.glassHi).r(2, h - 3, w - 4, 1, C.steelMid);
    p.r(3, 3, 2, 2, C.yellow).r(w - 5, 3, 2, 2, C.yellow);
  },
  foodtruck(p) {
    p.rbox(0, 2, U, U - 4, '#e58f4f', '#8f4f24');
    p.r(1, 3, U - 2, 2, '#f3e2a0').r(3, 6, U - 6, 4, C.glass).r(3, 10, U - 6, 1, C.white);
    for (let x = 1; x < U - 1; x += 4) p.r(x, 3, 2, 2, C.red);
    p.r(2, U - 3, 3, 2, C.black).r(U - 5, U - 3, 3, 2, C.black);
  },
  playtable(p, w, h) {
    shadow(p, w, h);
    for (const [sx, sy] of [[5, 1], [w - 10, 1], [5, h - 6], [w - 10, h - 6]]) p.rbox(sx, sy, 5, 5, C.woodMid, C.woodDark);
    p.rbox(2, 6, w - 4, h - 12, C.wood, C.woodDark).r(4, 8, w - 8, h - 16, C.green).r(4, 8, w - 8, 1, C.greenHi);
    // Cards and a playmat.
    p.r(8, 11, 3, 4, C.white).r(12, 11, 3, 4, C.lilac).r(w - 12, h - 15, 3, 4, C.white).r(w - 16, h - 15, 3, 4, C.yellow);
  },
  mixer(p, w, h, _rot, frame, def) {
    shadow(p, w, h);
    const roaster = def.station === 'roast';
    p.rbox(1, 1, w - 2, h - 2, C.steelMid, C.steelDark);
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    const rad = Math.min(cx, cy) - 4;
    p.disc(cx, cy, rad, C.steelDark).disc(cx, cy, rad - 1, roaster ? C.woodDeep : C.red).disc(cx - 1, cy - 1, Math.max(1, rad - 4), roaster ? C.woodDark : C.orange);
    // Paddle: turns between the two frames.
    if (frame % 2) p.r(cx - rad + 2, cy, rad * 2 - 3, 1, C.steelHi);
    else p.r(cx, cy - rad + 2, 1, rad * 2 - 3, C.steelHi);
    p.r(2, 2, 4, 3, C.iron).r(3, 3, 1, 1, C.screen);
  },
  bottler(p, w, h, _rot, frame) {
    shadow(p, w, h);
    const horizontal = w >= h;
    p.rbox(0, 1, w, h - 2, C.steelMid, C.steelDark);
    if (horizontal) {
      p.r(2, Math.floor(h / 2) - 2, w - 4, 5, C.black);
      for (let x = 3 + (frame % 2) * 3; x < w - 4; x += 6) p.r(x, Math.floor(h / 2) - 1, 2, 3, C.water).r(x, Math.floor(h / 2) - 1, 2, 1, C.white);
      p.box(Math.floor(w / 2) - 4, 2, 8, 4, C.lilac, C.line);
    } else {
      p.r(Math.floor(w / 2) - 2, 2, 5, h - 4, C.black);
      for (let y = 3 + (frame % 2) * 3; y < h - 4; y += 6) p.r(Math.floor(w / 2) - 1, y, 3, 2, C.water);
      p.box(2, Math.floor(h / 2) - 4, 4, 8, C.lilac, C.line);
    }
  },
  pump(p, w, h) {
    // Concrete island with the pump on it.
    p.rbox(1, 9, w - 2, 6, C.lilacHi, C.lilacDark);
    p.rbox(3, 1, 10, 12, C.red, C.redDark).box(5, 3, 6, 4, C.white, C.steelDark).r(6, 4, 3, 1, C.black);
    p.r(12, 5, 2, 6, C.black).r(13, 10, 1, 3, C.black);
  },
  tank(p, w, h) {
    p.rbox(1, 1, w - 2, h - 2, C.lilacDark, C.line).r(3, 3, w - 6, h - 6, C.lilac);
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    p.disc(cx, cy, 6, C.line).disc(cx, cy, 5, C.steelMid).disc(cx, cy, 2, C.iron);
    p.r(3, 3, 5, 1, C.yellow).r(w - 8, h - 4, 5, 1, C.yellow);
  },
  carwash(p, w, h, _rot, frame) {
    const horizontal = w > h;
    p.rbox(0, 0, w, h, C.lilacDark, C.line);
    if (horizontal) {
      p.r(1, 4, w - 2, h - 8, C.iron);
      for (let x = 4 + (frame % 2) * 2; x < w - 6; x += 10) p.box(x, 1, 5, 4, C.water, C.line).box(x, h - 5, 5, 4, C.water, C.line);
    } else {
      p.r(4, 1, w - 8, h - 2, C.iron);
      for (let y = 4 + (frame % 2) * 2; y < h - 6; y += 10) p.box(1, y, 4, 5, C.water, C.line).box(w - 5, y, 4, 5, C.water, C.line);
    }
    p.r(1, 1, 3, 1, C.yellow).r(w - 4, 1, 3, 1, C.yellow);
  },
  repairbay(p, w, h) {
    p.rbox(0, 0, w, h, C.steelDark, C.ironDark).r(3, 3, w - 6, h - 6, C.iron);
    const horizontal = w > h;
    if (horizontal) for (let x = 5; x < w - 6; x += 6) p.r(x, 4, 3, h - 8, C.yellow);
    else for (let y = 5; y < h - 6; y += 6) p.r(4, y, w - 8, 3, C.yellow);
    // Tool chest.
    p.box(2, 2, 6, 5, C.red, C.redDark).r(3, 4, 4, 1, C.steelHi);
  },
  vending(p) {
    p.tile('urban', 12, 10);
  },
  gate(p, w, h) {
    shadow(p, w, h);
    p.rbox(1, 3, 4, 10, C.teal, C.greenDark).rbox(w - 5, 3, 4, 10, C.teal, C.greenDark);
    p.r(5, 7, w - 10, 2, C.steelHi).r(5, 9, w - 10, 1, C.steelDark);
    p.box(2, 4, 2, 2, C.screen, C.greenDark);
  },
  slide(p, w, h) {
    const horizontal = w > h;
    shadow(p, w, h);
    if (horizontal) {
      p.rbox(1, 2, 14, h - 4, C.lilac, C.line).r(3, 4, 10, 2, C.lilacHi);
      p.r(14, 5, w - 30, 6, C.water).r(14, 5, w - 30, 1, C.waterHi).r(14, 4, w - 30, 1, C.line).r(14, 11, w - 30, 1, C.line);
      p.rbox(w - 17, 1, 16, h - 2, C.cream, C.woodDark).r(w - 15, 3, 12, h - 6, C.water).r(w - 14, 4, 4, 1, C.waterHi);
    } else {
      p.rbox(2, 1, w - 4, 14, C.lilac, C.line).r(4, 3, 2, 10, C.lilacHi).r(10, 3, 2, 10, C.lilacHi);
      p.r(5, 14, 6, h - 30, C.water).r(5, 14, 1, h - 30, C.waterHi).r(4, 14, 1, h - 30, C.line).r(11, 14, 1, h - 30, C.line);
      p.rbox(1, h - 17, w - 2, 16, C.cream, C.woodDark).r(3, h - 15, w - 6, 12, C.water).r(4, h - 14, 4, 1, C.waterHi);
    }
  },
  pool(p, w, h, _rot, frame) {
    // Tiled edge from the urban pack's water set, stretched to any size.
    const cols = w / U;
    const rows = h / U;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) p.tile('urban', x === 0 ? 8 : x === cols - 1 ? 10 : 9, y === 0 ? 6 : y === rows - 1 ? 8 : 7, x * U, y * U);
    }
    // Ripples that shift between frames.
    for (let y = 10; y < h - 8; y += 9) for (let x = 8 + ((y + frame * 5) % 11); x < w - 10; x += 14) p.r(x, y, 4, 1, C.waterHi);
  },
  carousel(p, w, h, _rot, frame) {
    shadow(p, w, h);
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    const rad = Math.min(cx, cy) - 2;
    p.disc(cx, cy, rad, C.woodDark).disc(cx, cy, rad - 1, C.cream);
    // Striped canopy segments rotate by one step per frame.
    const colors = ['#e87ba4', C.white, C.yellow, C.white];
    for (let a = 0; a < 16; a++) {
      const ang = ((a + frame * 0.5) / 16) * Math.PI * 2;
      for (let d = 3; d < rad - 1; d++) p.r(cx + Math.round(Math.cos(ang) * d), cy + Math.round(Math.sin(ang) * d), 2, 2, colors[a % 4]);
    }
    p.disc(cx, cy, 2, C.orangeHi);
  },
  bumper(p, w, h, _rot, frame) {
    p.rbox(0, 0, w, h, C.iron, C.ironDark).r(2, 2, w - 4, h - 4, C.steelDark);
    const cars = ['#f2b84b', C.red, C.water, C.green, C.lilac];
    cars.forEach((c, i) => {
      const x = 6 + ((i * 23 + frame * (i % 2 ? 3 : -3) + 60) % (w - 20));
      const y = 5 + ((i * 17 + frame * (i % 2 ? -2 : 2) + 40) % (h - 16));
      p.rbox(x, y, 8, 6, c, C.black).r(x + 2, y + 1, 4, 2, C.white);
    });
  },
  arcade(p, w, h, rot, frame) {
    const t = cab(p, 0, 0, w, h, C.lilac, C.lilacDark, C.line, rot);
    p.box(t.x + 1, t.y + 1, t.w - 2, 5, C.black, C.ironDark).r(t.x + 3, t.y + 2, 3, 2, frame % 2 ? C.yellow : C.screen).r(t.x + 7, t.y + 3, 2, 1, frame % 2 ? C.screen : C.red);
    p.r(t.x + 2, t.y + 7, 2, 2, C.red).r(t.x + t.w - 4, t.y + 7, 2, 2, C.yellow);
  },
  stall(p, w, h, rot) {
    const t = cab(p, 0, 0, w, h, C.wood, C.woodMid, C.woodDark, rot);
    // Striped awning.
    for (let x = t.x, i = 0; x < t.x + t.w; x += 4, i++) p.r(x, t.y, Math.min(4, t.x + t.w - x), Math.min(6, t.h), i % 2 ? C.white : C.yellow);
    p.r(t.x, t.y + Math.min(6, t.h), t.w, 1, C.woodDark);
  },
  fountain(p, w, h, _rot, frame) {
    shadow(p, w, h);
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    p.disc(cx, cy, cx - 2, C.lilacDark).disc(cx, cy, cx - 3, C.lilacHi).disc(cx, cy, cx - 5, C.water);
    p.disc(cx, cy, 3, C.lilacHi).disc(cx, cy, 1, C.glassHi);
    // Splashes alternate.
    const d = frame % 2 ? 6 : 8;
    for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) p.r(cx + dx, cy + dy, 1, 1, C.glassHi);
  },
};

/** How many animation frames each sprite has. Unlisted sprites have one. */
const FRAMES: Record<string, number> = { dancefloor: 4, treadmill: 2, cinema: 2, pinball: 2, washer: 4, dryer: 4, oven: 2, mixer: 2, bottler: 2, carwash: 2, pool: 2, carousel: 2, bumper: 2, arcade: 2, fountain: 2 };
/** Sprites that look the same from every side, so one facing is painted and shared. */
const SYMMETRIC = new Set(['dancefloor', 'weights', 'studio', 'hotelbed', 'cinema', 'carstand', 'foodtruck', 'vanbay', 'mannequin', 'fitting', 'airhockey', 'plant', 'lamp', 'bin', 'vending', 'tank', 'playtable', 'fountain', 'carousel', 'pool', 'bumper', 'gate', 'mixer']);

const spriteOf = (defId: string): string => {
  const d = FURNITURE[defId];
  // The order counter shares the checkout's data-driven behaviour but gets its own look.
  if (defId === 'counter') return 'counter';
  return d.sprite ?? '';
};

export const furnFrameCount = (defId: string): number => FRAMES[spriteOf(defId)] ?? 1;

/** Atlas frame for a piece of furniture at a rotation and animation frame. */
export function furnFrame(defId: string, rot: number, frame = 0): string {
  const r = SYMMETRIC.has(spriteOf(defId)) ? ((FURNITURE[defId].w ?? 1) === (FURNITURE[defId].h ?? 1) ? 0 : rot % 2) : rot % 4;
  return `furn:${defId}:${r}:${frame % furnFrameCount(defId)}`;
}

/**
 * Where goods are shown on a shelf-like sprite, one rectangle per slot, in source pixels
 * relative to the frame. Must agree with the recess painted by the shelf-type painters.
 */
export function slotAreas(defId: string, rot: number, slots: number): { x: number; y: number; w: number; h: number }[] {
  const d = FURNITURE[defId];
  const along = rot % 2 === 0;
  const w = (along ? d.w ?? 1 : d.h ?? 1) * U;
  const h = (along ? d.h ?? 1 : d.w ?? 1) * U;
  // Mirror the insets used by cab(): outline, facing strip, then the recess border.
  const t = { x: 2, y: 2, w: w - 4, h: h - 4 };
  if (rot % 4 === 0) t.h -= 5;
  else if (rot % 4 === 2) { t.y += 2; t.h -= 2; }
  else if (rot % 4 === 1) { t.x += 4; t.w -= 4; }
  else t.w -= 4;
  const out = [];
  for (let i = 0; i < slots; i++) {
    if (w >= h) out.push({ x: t.x + Math.round((t.w / slots) * i), y: t.y, w: Math.round(t.w / slots) - (i < slots - 1 ? 1 : 0), h: t.h });
    else out.push({ x: t.x, y: t.y + Math.round((t.h / slots) * i), w: t.w, h: Math.round(t.h / slots) - (i < slots - 1 ? 1 : 0) });
  }
  return out;
}

const FLOORS: Record<string, (p: Pix) => void> = {
  floor_concrete: (p) => p.r(0, 0, U, U, '#aaaeba').r(0, 0, U, 1, '#a5abb4').r(0, 0, 1, U, '#a5abb4').r(9, 6, 2, 1, '#9ea3ac').r(4, 12, 1, 1, '#9ea3ac'),
  floor_tile: (p) => p.r(0, 0, U, U, '#e6dabf').r(0, 0, U, 1, '#d9caa9').r(0, 0, 1, U, '#d9caa9').r(8, 0, 1, U, '#d9caa9').r(0, 8, U, 1, '#d9caa9'),
  floor_wood: (p) => {
    p.r(0, 0, U, U, C.wood);
    for (let y = 0; y < U; y += 4) p.r(0, y, U, 1, C.woodMid);
    p.r(5, 1, 1, 3, C.woodMid).r(12, 5, 1, 3, C.woodMid).r(3, 9, 1, 3, C.woodMid).r(10, 13, 1, 3, C.woodMid);
  },
  floor_grass: (p) => p.tile('urban', 1, 1),
  floor_paving: (p) => p.tile('urban', 9, 4),
};

export function registerFurnitureFrames(): void {
  for (const [id, d] of Object.entries(FURNITURE)) {
    if (d.category === 'structure') continue;
    const sprite = spriteOf(id);
    const paint = PAINTERS[sprite];
    const frames = FRAMES[sprite] ?? 1;
    const rotations = SYMMETRIC.has(sprite) ? ((d.w ?? 1) === (d.h ?? 1) ? [0] : [0, 1]) : [0, 1, 2, 3];
    for (const rot of rotations) {
      const w = (rot % 2 === 0 ? d.w ?? 1 : d.h ?? 1) * U;
      const h = (rot % 2 === 0 ? d.h ?? 1 : d.w ?? 1) * U;
      for (let f = 0; f < frames; f++) {
        addFrame(`furn:${id}:${rot}:${f}`, w, h, (p) => {
          if (paint) paint(p, w, h, rot, f, d);
          // Anything without a painter still shows up, as a plain crate in its data colour.
          else cab(p, 0, 0, w, h, d.color, C.steelMid, C.line, rot);
        });
      }
    }
  }

  for (const [id, paint] of Object.entries(FLOORS)) addFrame(`floor:${id}`, U, U, paint);
  // Any floor added in data without art falls back to its colour.
  for (const [id, d] of Object.entries(FURNITURE)) if (d.kind === 'floor') addFrame(`floor:${id}`, U, U, (p) => p.r(0, 0, U, U, d.color));

  // A wall block: lit cap on top, shaded face below.
  addFrame('wall', U, U, (p) => p.r(0, 0, U, U, C.line).r(0, 0, U, 7, C.lilacHi).r(0, 7, U, 1, C.lilac).r(0, 8, U, 7, C.lilacDark).r(0, 0, 1, 7, C.lilac).r(15, 0, 1, 7, C.lilac));
  // Doors: in a wall running east-west you see the door itself; in a north-south wall, a threshold.
  addFrame('door_h', U, U, (p) => p.r(0, 0, U, U, C.cream).tile('urban', 13, 10));
  addFrame('door_v', U, U, (p) => p.r(0, 0, U, U, C.cream).r(0, 0, U, 2, C.line).r(0, 14, U, 2, C.line).box(5, 2, 6, 12, C.orangeHi, C.woodDark).r(9, 7, 1, 2, C.yellow));
  // Out-of-order badge shown over broken machines.
  addFrame('broken', 12, 12, (p) => {
    p.disc(6, 6, 5, '#ffffff').disc(6, 6, 4, '#e5605a');
    for (let i = -2; i <= 2; i++) p.r(6 + i, 6 + i, 1, 1, '#ffffff').r(6 + i, 6 - i, 1, 1, '#ffffff');
  });
}
