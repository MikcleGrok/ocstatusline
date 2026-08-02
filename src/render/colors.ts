import { sgr, RESET } from './ansi.js';
import type { ColorLevel } from '../types/index.js';

const NAMED: Record<string, number> = {
  black: 0, red: 1, green: 2, yellow: 3, blue: 4, magenta: 5, cyan: 6, white: 7,
};

const DYNAMIC_COLORS: Record<number, { ansi16: number; rgb: [number, number, number] }> = {
  33: { ansi16: 33, rgb: [0, 135, 255] },
  124: { ansi16: 31, rgb: [175, 0, 0] },
};

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function colorize(text: string, opts: { color?: string | number; bold?: boolean }, level: ColorLevel): string {
  const codes: (string | number)[] = [];
  if (opts.bold) codes.push(1);
  if (opts.color !== undefined) {
    if (typeof opts.color === 'number') {
      const dynamic = DYNAMIC_COLORS[opts.color];
      if (level === 'ansi256') codes.push(38, 5, opts.color);
      else if (dynamic && level === 'ansi16') codes.push(dynamic.ansi16);
      else if (dynamic && level === 'truecolor') codes.push(38, 2, ...dynamic.rgb);
    } else {
      const color = opts.color;
      const rgb = hexToRgb(color);
      if (rgb && level === 'truecolor') codes.push(38, 2, rgb[0], rgb[1], rgb[2]);
      else if (NAMED[color] !== undefined) codes.push(30 + NAMED[color]);
      else if (rgb) codes.push(30 + 7);
    }
  }
  if (codes.length === 0) return text;
  return sgr(codes) + text + RESET;
}
