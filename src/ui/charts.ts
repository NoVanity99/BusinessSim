import { h } from './dom';

export interface Series {
  name: string;
  color: string;
  values: number[];
}

/** Validated against the panel surface (#1b2230) for colour-vision separation and contrast. */
export const SERIES_COLORS = { income: '#3987e5', expense: '#d95926' } as const;

const NS = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** Round up to a tidy axis maximum (1, 2, 2.5 or 5 times a power of ten). */
function niceMax(v: number): number {
  if (v <= 0) return 10;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((m) => m >= v) ?? 10 * pow;
}

/**
 * Line chart for a handful of series sharing one axis. Includes a legend, end labels,
 * and a crosshair with a tooltip listing every series at the hovered point.
 */
export function lineChart(labels: string[], series: Series[], format: (n: number) => string, width = 520, height = 200): HTMLElement {
  const pad = { l: 46, r: 12, t: 10, b: 22 };
  const w = width - pad.l - pad.r;
  const hgt = height - pad.t - pad.b;
  const n = labels.length;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const x = (i: number): number => pad.l + (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v: number): number => pad.t + hgt - (v / max) * hgt;

  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', role: 'img', 'aria-label': series.map((s) => s.name).join(' and ') + ' per day' });
  // Recessive grid: four horizontal rules with axis values.
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    root.append(svg('line', { x1: pad.l, x2: width - pad.r, y1: y(v), y2: y(v), stroke: 'rgba(255,255,255,0.08)', 'stroke-width': 1 }));
    const t = svg('text', { x: pad.l - 6, y: y(v) + 4, 'text-anchor': 'end', fill: '#8f9bb0', 'font-size': 11 });
    t.textContent = format(v);
    root.append(t);
  }
  // A few x labels: first, last and evenly spaced between.
  const ticks = Math.min(n, 6);
  for (let k = 0; k < ticks; k++) {
    const i = ticks === 1 ? 0 : Math.round((k / (ticks - 1)) * (n - 1));
    const t = svg('text', { x: x(i), y: height - 6, 'text-anchor': k === 0 ? 'start' : k === ticks - 1 ? 'end' : 'middle', fill: '#8f9bb0', 'font-size': 11 });
    t.textContent = labels[i];
    root.append(t);
  }
  for (const s of series) {
    if (n > 1) root.append(svg('polyline', { points: s.values.map((v, i) => `${x(i)},${y(v)}`).join(' '), fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    // End marker with a surface-coloured ring so overlapping lines stay distinct.
    root.append(svg('circle', { cx: x(n - 1), cy: y(s.values[n - 1] ?? 0), r: 4, fill: s.color, stroke: '#1b2230', 'stroke-width': 2 }));
  }

  const cross = svg('line', { y1: pad.t, y2: pad.t + hgt, stroke: 'rgba(255,255,255,0.35)', 'stroke-width': 1, visibility: 'hidden' });
  const dots = series.map((s) => svg('circle', { r: 4, fill: s.color, stroke: '#1b2230', 'stroke-width': 2, visibility: 'hidden' }));
  root.append(cross, ...dots);

  const tip = h('div.chart-tip');
  const legend = h('div.legend', ...series.map((s) => h('span', h('i', { style: { background: s.color } }), s.name)));
  const wrap = h('div.chart', legend, root as unknown as Node, tip);

  root.addEventListener('mousemove', (e) => {
    const r = root.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * width;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - pad.l) / w) * (n - 1))));
    cross.setAttribute('x1', String(x(i)));
    cross.setAttribute('x2', String(x(i)));
    cross.setAttribute('visibility', 'visible');
    series.forEach((s, k) => {
      dots[k].setAttribute('cx', String(x(i)));
      dots[k].setAttribute('cy', String(y(s.values[i] ?? 0)));
      dots[k].setAttribute('visibility', 'visible');
    });
    tip.replaceChildren(h('b', labels[i]), ...series.map((s) => h('div', h('i', { style: { background: s.color } }), `${s.name}: ${format(s.values[i] ?? 0)}`)));
    tip.style.display = 'block';
    const left = ((x(i) / width) * r.width);
    tip.style.left = `${left > r.width / 2 ? left - tip.offsetWidth - 10 : left + 10}px`;
  });
  root.addEventListener('mouseleave', () => {
    cross.setAttribute('visibility', 'hidden');
    dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
    tip.style.display = 'none';
  });
  return wrap;
}
