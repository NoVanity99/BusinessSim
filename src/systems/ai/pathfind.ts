import type { Grid } from './grid';

/**
 * A* over the tile grid with 8-way movement (no cutting corners around walls).
 * Scratch buffers are reused between calls and invalidated with a generation stamp,
 * so a search allocates nothing but its result.
 */
let size = 0;
let g: Float32Array;
let f: Float32Array;
let from: Int32Array;
let stamp: Uint32Array;
let closed: Uint32Array;
let heap: Int32Array;
let generation = 0;

function ensure(n: number): void {
  if (n === size) return;
  size = n;
  g = new Float32Array(n);
  f = new Float32Array(n);
  from = new Int32Array(n);
  stamp = new Uint32Array(n);
  closed = new Uint32Array(n);
  heap = new Int32Array(n * 8);
  generation = 0;
}

const NX = [1, -1, 0, 0, 1, 1, -1, -1];
const NY = [0, 0, 1, -1, 1, -1, 1, -1];

/** Returns tile indices from the first step to the goal (start excluded), [] if already there, or null if unreachable. */
export function findPath(grid: Grid, sx: number, sy: number, gx: number, gy: number, crowd?: Uint8Array): number[] | null {
  const { w, h, cost } = grid;
  if (gx < 0 || gy < 0 || gx >= w || gy >= h) return null;
  const start = sy * w + sx;
  const goal = gy * w + gx;
  if (cost[goal] === 0) return null;
  if (start === goal) return [];
  ensure(w * h);
  generation++;

  let heapSize = 0;
  const push = (node: number): void => {
    let i = heapSize++;
    heap[i] = node;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (f[heap[parent]] <= f[node]) break;
      heap[i] = heap[parent];
      i = parent;
    }
    heap[i] = node;
  };
  const pop = (): number => {
    const top = heap[0];
    const last = heap[--heapSize];
    let i = 0;
    for (;;) {
      let child = i * 2 + 1;
      if (child >= heapSize) break;
      if (child + 1 < heapSize && f[heap[child + 1]] < f[heap[child]]) child++;
      if (f[heap[child]] >= f[last]) break;
      heap[i] = heap[child];
      i = child;
    }
    heap[i] = last;
    return top;
  };
  const heuristic = (x: number, y: number): number => {
    const dx = Math.abs(x - gx);
    const dy = Math.abs(y - gy);
    return 10 * (dx + dy) - 5.86 * Math.min(dx, dy);
  };

  g[start] = 0;
  f[start] = heuristic(sx, sy);
  from[start] = -1;
  stamp[start] = generation;
  push(start);

  while (heapSize > 0) {
    const cur = pop();
    if (cur === goal) {
      const path: number[] = [];
      for (let n = goal; n !== start; n = from[n]) path.push(n);
      return path.reverse();
    }
    if (closed[cur] === generation) continue;
    closed[cur] = generation;
    const cx = cur % w;
    const cy = (cur - cx) / w;
    for (let d = 0; d < 8; d++) {
      const nx = cx + NX[d];
      const ny = cy + NY[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      const c = cost[n];
      if (c === 0 || closed[n] === generation) continue;
      // Diagonals need both side tiles open.
      if (d >= 4 && (cost[cy * w + nx] === 0 || cost[ny * w + cx] === 0)) continue;
      // A crowded tile costs more, so people fan out instead of filing through the same spot.
      const step = crowd ? c + Math.min(crowd[n], 4) * 7 : c;
      const ng = g[cur] + (d >= 4 ? step * 1.414 : step);
      if (stamp[n] === generation && ng >= g[n]) continue;
      g[n] = ng;
      f[n] = ng + heuristic(nx, ny);
      from[n] = cur;
      stamp[n] = generation;
      push(n);
    }
  }
  return null;
}
