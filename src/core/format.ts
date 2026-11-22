export function money(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const str = abs >= 10000 ? Math.round(abs).toLocaleString('en-US') : abs.toLocaleString('en-US', { minimumFractionDigits: abs % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return `${sign}$${str}`;
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
