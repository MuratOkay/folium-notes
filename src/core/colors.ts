/** Note colors. "grey" is accepted as an alias of "gray". */

export const COLORS = [
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'gray',
] as const;

export type Color = (typeof COLORS)[number];

export const NO_COLOR = 'none';

export function normalizeColor(value: unknown): Color | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().toLowerCase();
  if (!text || text === 'none' || text === 'null') return undefined;
  if (text === 'grey') return 'gray';
  return (COLORS as readonly string[]).includes(text) ? (text as Color) : undefined;
}

export function isColor(value: unknown): value is Color {
  return normalizeColor(value) !== undefined;
}

/** Swatch colors used by the tree views and the editor gutter. */
export const COLOR_HEX: Record<Color, string> = {
  red: '#e5534b',
  orange: '#e0823d',
  yellow: '#d4a72c',
  green: '#57ab5a',
  blue: '#539bf5',
  purple: '#b083f0',
  pink: '#e275ad',
  gray: '#8b949e',
};

/** Theme colors used for TreeItem.iconPath (follows the active theme). */
export const COLOR_THEME: Record<Color, string> = {
  red: 'charts.red',
  orange: 'charts.orange',
  yellow: 'charts.yellow',
  green: 'charts.green',
  blue: 'charts.blue',
  purple: 'charts.purple',
  pink: 'charts.pink',
  gray: 'charts.foreground',
};

export function colorLabel(color: Color | undefined): string {
  return color ?? NO_COLOR;
}
