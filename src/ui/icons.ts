/**
 * One icon set for the whole interface: 20px line icons drawn on a 24-unit grid, coloured
 * by the text colour of whatever they sit in.
 */
const PATHS: Record<string, string> = {
  shop: 'M3 10l1.5-5h15L21 10M4 10v10h16V10M3 10a3 3 0 006 0 3 3 0 006 0 3 3 0 006 0M9 20v-5h6v5',
  chart: 'M4 4v16h16M8 16v-4M12 16V8M16 16v-6',
  people: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.5a3.5 3.5 0 010 6.5M18 14.3c2.2.7 3.5 2.6 3.5 5.7',
  trophy: 'M8 4h8v6a4 4 0 01-8 0V4zM8 6H4.5c0 3 1.3 4.5 3.7 4.8M16 6h3.5c0 3-1.3 4.5-3.7 4.8M12 14v4M8 20h8',
  bell: 'M6 16V11a6 6 0 0112 0v5l1.5 2h-15L6 16zM10 20a2 2 0 004 0',
  map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6zM9 4v14M15 6v14',
  feet: 'M8 4c1.7 0 2.5 2 2.5 4.5S9.5 13 8 13s-2.5-2-2.5-4.500S6.300 4 8 4zM6 15.500h4V17a2 2 0 01-4 0v-1.500zM16 8c1.700 0 2.500 2 2.500 4.500S17.500 17 16 17s-2.500-2-2.500-4.500S14.300 8 16 8zM14 19.500h4V20a2 2 0 01-4 0v-.5z',
  broom: 'M19 3l-8 9M8 11l5 5-3 5H4l1-5 3-5zM6 17l2 2',
  smile: 'M12 21a9 9 0 100-18 9 9 0 000 18zM8.500 14.500c.9 1.200 2.100 1.800 3.500 1.800s2.600-.6 3.500-1.800M9 9.500v.5M15 9.500v.5',
  menu: 'M4 7h16M4 12h16M4 17h16',
  pause: 'M8 5v14M16 5v14',
  play: 'M7 5l12 7-12 7V5z',
  fast: 'M4 6l8 6-8 6V6zM13 6l8 6-8 6V6z',
  faster: 'M2 7l6 5-6 5V7zM9 7l6 5-6 5V7zM16 7l6 5-6 5V7z',
  sun: 'M12 16a4 4 0 100-8 4 4 0 000 8zM12 2v2.500M12 19.500V22M2 12h2.500M19.500 12H22M5 5l1.800 1.800M17.200 17.200L19 19M5 19l1.800-1.800M17.200 6.800L19 5',
  cloud: 'M7 18a4 4 0 01-.5-8 5.500 5.500 0 0110.700 1.200A3.500 3.500 0 0117 18H7z',
  rain: 'M7 15a4 4 0 01-.5-8 5.500 5.500 0 0110.700 1.200A3.500 3.500 0 0117 15H7zM8 18l-1 3M12 18l-1 3M16 18l-1 3',
  snow: 'M7 14a4 4 0 01-.5-8 5.500 5.500 0 0110.700 1.200A3.500 3.500 0 0117 14H7zM8 18v.500M12 17.500v.5M16 18v.500M10 21v.500M14 21v.500',
  fog: 'M4 9h16M6 13h14M4 17h12',
  heat: 'M12 3v10.500a3.500 3.500 0 11-3 0V6a3 3 0 013-3zM17 5h3M17 9h3M17 13h2',
  star: 'M12 3l2.700 5.800 6.300.800-4.600 4.300 1.200 6.200L12 17l-5.600 3.100 1.200-6.200L3 9.600l6.300-.8L12 3z',
  alert: 'M12 3l10 17H2L12 3zM12 10v4.500M12 17.500v.5',
  check: 'M4 12.500l5 5L20 6.500',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v6M12 7.500v.5',
  close: 'M6 6l12 12M18 6L6 18',
  coin: 'M12 21a9 9 0 100-18 9 9 0 000 18zM14.500 9.500c-.5-1-1.400-1.500-2.500-1.500-1.500 0-2.500.8-2.500 2s1 1.700 2.500 2 2.500.8 2.500 2-1 2-2.500 2c-1.200 0-2.100-.5-2.600-1.500M12 6.500V8M12 16v1.500',
  dashboard: 'M4 4h7v9H4V4zM13 4h7v5h-7V4zM13 11h7v9h-7v-9zM4 15h7v5H4v-5z',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM16 16l4.500 4.500',
};

export type IconName = keyof typeof PATHS;

export function icon(name: string, size = 20): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', '1.8');
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('aria-hidden', 'true');
  el.classList.add('icon');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', PATHS[name] ?? PATHS.info);
  el.append(path);
  return el;
}

/** The icon that goes with each weather kind. */
export const WEATHER_ICON: Record<string, string> = { sunny: 'sun', cloudy: 'cloud', rain: 'rain', fog: 'fog', snow: 'snow', heat: 'heat' };
