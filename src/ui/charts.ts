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

/** Eight categorical hues in fixed order, validated on the panel surface for colour-vision separation. */
export const CATEGORICAL = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'] as const;
/** Everything past the palette folds into one neutral "Other" slice. */
export const OTHER_COLOR = '#6b7688';
const SURFACE = '#1b2230';

/** Keep the largest parts and fold the rest into "Other", so colours never have to repeat. */
export function foldParts(parts: { name: string; value: number }[], keep = 6): { name: string; value: number; color: string }[] {
  const sorted = parts.filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, keep).map((p, i) => ({ ...p, color: CATEGORICAL[i] as string }));
  const rest = sorted.slice(keep).reduce((a, p) => a + p.value, 0);
  if (rest > 0) top.push({ name: 'Other', value: rest, color: OTHER_COLOR });
  return top;
}

/**
 * Bar chart with one bar per label; several series stack. Bars have rounded tops, a gap
 * in the surface colour between segments, and a tooltip listing every series for the bar.
 */
export function barChart(labels: string[], series: Series[], format: (n: number) => string, width = 520, height = 180): HTMLElement {
  const pad = { l: 46, r: 8, t: 10, b: 22 };
  const w = width - pad.l - pad.r;
  const hgt = height - pad.t - pad.b;
  const n = labels.length;
  const totals = labels.map((_l, i) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  const max = niceMax(Math.max(1, ...totals));
  const band = w / Math.max(1, n);
  const bw = Math.max(2, Math.min(26, band - 3));
  const y = (v: number): number => pad.t + hgt - (v / max) * hgt;
  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', role: 'img', 'aria-label': series.map((s) => s.name).join(', ') });
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    root.append(svg('line', { x1: pad.l, x2: width - pad.r, y1: y(v), y2: y(v), stroke: 'rgba(255,255,255,0.08)', 'stroke-width': 1 }));
    const t = svg('text', { x: pad.l - 6, y: y(v) + 4, 'text-anchor': 'end', fill: '#8f9bb0', 'font-size': 11 });
    t.textContent = format(v);
    root.append(t);
  }
  const every = Math.max(1, Math.ceil(n / 8));
  const hits: SVGRectElement[] = [];
  labels.forEach((label, i) => {
    const cx = pad.l + band * (i + 0.5);
    if (i % every === 0) {
      const t = svg('text', { x: cx, y: height - 6, 'text-anchor': 'middle', fill: '#8f9bb0', 'font-size': 11 });
      t.textContent = label;
      root.append(t);
    }
    let base = 0;
    series.forEach((s, k) => {
      const v = s.values[i] ?? 0;
      if (v <= 0) return;
      const top = y(base + v);
      const bottom = y(base);
      const last = series.slice(k + 1).every((o) => (o.values[i] ?? 0) <= 0);
      const r = last ? Math.min(4, bw / 2, (bottom - top) / 2) : 0;
      // Rounded at the data end only; a 2px surface gap separates stacked segments.
      const gap = k > 0 && base > 0 ? 2 : 0;
      const h2 = Math.max(1, bottom - top - gap);
      root.append(svg('path', { d: `M${cx - bw / 2},${top + h2} v${-(h2 - r)} q0,${-r} ${r},${-r} h${bw - 2 * r} q${r},0 ${r},${r} v${h2 - r} z`, fill: s.color }));
      base += v;
    });
    hits.push(svg('rect', { x: pad.l + band * i, y: pad.t, width: band, height: hgt, fill: 'transparent' }));
  });
  root.append(...hits);
  const tip = h('div.chart-tip');
  const legend = series.length > 1 ? h('div.legend', ...series.map((s) => h('span', h('i', { style: { background: s.color } }), s.name))) : false;
  const wrap = h('div.chart', legend, root as unknown as Node, tip);
  hits.forEach((hit, i) => {
    hit.addEventListener('mousemove', () => {
      const r = root.getBoundingClientRect();
      hits.forEach((o, k) => o.setAttribute('fill', k === i ? 'rgba(255,255,255,0.06)' : 'transparent'));
      tip.replaceChildren(h('b', labels[i]), ...series.map((s) => h('div', h('i', { style: { background: s.color } }), `${s.name}: ${format(s.values[i] ?? 0)}`)));
      tip.style.display = 'block';
      const left = ((pad.l + band * (i + 0.5)) / width) * r.width;
      tip.style.left = `${left > r.width / 2 ? left - tip.offsetWidth - 10 : left + 10}px`;
    });
  });
  root.addEventListener('mouseleave', () => {
    hits.forEach((o) => o.setAttribute('fill', 'transparent'));
    tip.style.display = 'none';
  });
  return wrap;
}

/**
 * Donut for a whole split into a few parts, with the total in the middle and a legend
 * that carries every name, value and share, so nothing is read from colour or angle alone.
 */
export function donutChart(parts: { name: string; value: number; color: string }[], format: (n: number) => string, centre = 'Total', size = 150): HTMLElement {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const root = svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: 'img', 'aria-label': parts.map((p) => `${p.name} ${format(p.value)}`).join(', ') });
  const c = size / 2;
  const r1 = size / 2 - 4;
  const r0 = r1 * 0.6;
  const rows: HTMLElement[] = [];
  const arcs: SVGPathElement[] = [];
  let a0 = -Math.PI / 2;
  const pt = (r: number, a: number): string => `${c + r * Math.cos(a)},${c + r * Math.sin(a)}`;
  if (total <= 0) root.append(svg('circle', { cx: c, cy: c, r: (r0 + r1) / 2, fill: 'none', stroke: 'rgba(255,255,255,0.08)', 'stroke-width': r1 - r0 }));
  parts.forEach((p, i) => {
    const share = total > 0 ? p.value / total : 0;
    const a1 = a0 + share * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    // A full circle cannot be drawn as one arc; nudge the end.
    const end = share >= 0.9999 ? a1 - 0.0001 : a1;
    const arc = svg('path', { d: `M${pt(r1, a0)} A${r1},${r1} 0 ${large} 1 ${pt(r1, end)} L${pt(r0, end)} A${r0},${r0} 0 ${large} 0 ${pt(r0, a0)} Z`, fill: p.color, stroke: SURFACE, 'stroke-width': 2 });
    arcs.push(arc);
    root.append(arc);
    a0 = a1;
    rows.push(h('div.donut-row', h('i', { style: { background: p.color } }), h('span.name', p.name), h('span.val', format(p.value)), h('span.pct', `${Math.round(share * 100)}%`)));
    const focus = (on: boolean): void => {
      arcs.forEach((o, k) => o.setAttribute('opacity', on && k !== i ? '0.35' : '1'));
      rows.forEach((o, k) => o.classList.toggle('hot', on && k === i));
    };
    arc.addEventListener('mouseenter', () => focus(true));
    arc.addEventListener('mouseleave', () => focus(false));
    rows[i].addEventListener('mouseenter', () => focus(true));
    rows[i].addEventListener('mouseleave', () => focus(false));
  });
  const label = svg('text', { x: c, y: c - 4, 'text-anchor': 'middle', fill: '#8f9bb0', 'font-size': 10 });
  label.textContent = centre;
  const value = svg('text', { x: c, y: c + 12, 'text-anchor': 'middle', fill: '#e8edf5', 'font-size': 14, 'font-weight': 700 });
  value.textContent = format(total);
  root.append(label, value);
  return h('div.donut', root as unknown as Node, h('div.donut-legend', ...(rows.length ? rows : [h('div.dim', 'Nothing yet.')])));
}

/** A tiny trend line with no axes, for table rows and tiles. */
export function sparkline(values: number[], color: string = CATEGORICAL[0], width = 84, height = 24): SVGSVGElement {
  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, width, height, 'aria-hidden': 'true' });
  const max = Math.max(1, ...values);
  const n = values.length;
  if (n > 1) {
    const pts = values.map((v, i) => `${2 + (i / (n - 1)) * (width - 4)},${height - 3 - (v / max) * (height - 6)}`);
    root.append(svg('polyline', { points: pts.join(' '), fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    const [lx, ly] = pts[n - 1].split(',');
    root.append(svg('circle', { cx: lx, cy: ly, r: 2.5, fill: color }));
  }
  return root;
}
