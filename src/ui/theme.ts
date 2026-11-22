/** One palette for UI and procedural art, so everything stays visually consistent. */
export const COLORS = {
  bg: 0x10141c,
  panel: 0x1b2230,
  panelLight: 0x263042,
  border: 0x3a4760,
  text: 0xe8edf5,
  textDim: 0x8f9bb0,
  accent: 0x4fc3a1,
  accentHover: 0x6fe0bd,
  money: 0x8fd16a,
  warn: 0xf2b84b,
  danger: 0xe5605a,
  info: 0x5aa9e6,
} as const;

export const hex = (c: number): string => '#' + c.toString(16).padStart(6, '0');

export const FONT = 'system-ui, "Segoe UI", Roboto, sans-serif';

export function textStyle(
  size = 16,
  color: number = COLORS.text,
  extra: Phaser.Types.GameObjects.Text.TextStyle = {},
): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontFamily: FONT, fontSize: `${size}px`, color: hex(color), ...extra };
}
