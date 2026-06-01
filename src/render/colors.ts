import { sgr, RESET } from './ansi.js';
import type { ColorLevel } from '../types/index.js';

const NAMED: Record<string, number> = {
  black: 0, red: 1, green: 2, yellow: 3, blue: 4, magenta: 5, cyan: 6, white: 7,
};

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function colorize(text: string, opts: { color?: string; bold?: boolean }, level: ColorLevel): string {
  const codes: (string | number)[] = [];
  if (opts.bold) codes.push(1);
  if (opts.color) {
    const rgb = hexToRgb(opts.color);
    if (rgb && level === 'truecolor') codes.push(38, 2, rgb[0], rgb[1], rgb[2]);
    else if (NAMED[opts.color] !== undefined) codes.push(30 + NAMED[opts.color]);
    else if (rgb) codes.push(30 + 7); // fallback white-ish for hex on low-color terms
  }
  if (codes.length === 0) return text;
  return sgr(codes) + text + RESET;
}
