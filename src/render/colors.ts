import { sgr, RESET } from './ansi.js';
import type { ColorLevel } from '../types/index.js';

const NAMED: Record<string, number> = {
  black: 0, red: 1, green: 2, yellow: 3, blue: 4, magenta: 5, cyan: 6, white: 7,
};

const DYNAMIC_COLORS: Record<number, { ansi16: number; rgb: [number, number, number] }> = {
  75: { ansi16: 34, rgb: [95, 175, 215] },
  37: { ansi16: 36, rgb: [0, 175, 175] },
  71: { ansi16: 32, rgb: [95, 175, 95] },
  208: { ansi16: 33, rgb: [255, 0, 0] },
  124: { ansi16: 31, rgb: [175, 0, 0] },
  90: { ansi16: 35, rgb: [128, 0, 128] },
};

const ANSI16_PALETTE: [number, number, number][] = [[0, 0, 0], [128, 0, 0], [0, 128, 0], [128, 128, 0], [0, 0, 128], [128, 0, 128], [0, 128, 128], [192, 192, 192], [128, 128, 128], [255, 0, 0], [0, 255, 0], [255, 255, 0], [0, 0, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255]];

function ansi256ToRgb(color: number): [number, number, number] {
  if (color < 16) {
    return ANSI16_PALETTE[color];
  }
  if (color < 232) {
    const channel = (value: number): number => value === 0 ? 0 : 55 + value * 40;
    const index = color - 16;
    return [channel(Math.floor(index / 36)), channel(Math.floor(index / 6) % 6), channel(index % 6)];
  }
  const gray = 8 + (color - 232) * 10;
  return [gray, gray, gray];
}

function rgbToAnsi16(rgb: [number, number, number]): number {
  let nearest = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < ANSI16_PALETTE.length; index += 1) {
    const paletteColor = ANSI16_PALETTE[index];
    const currentDistance = (rgb[0] - paletteColor[0]) ** 2 + (rgb[1] - paletteColor[1]) ** 2 + (rgb[2] - paletteColor[2]) ** 2;
    if (currentDistance < distance) {
      nearest = index;
      distance = currentDistance;
    }
  }
  return nearest < 8 ? 30 + nearest : 90 + nearest - 8;
}

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
      else if (level === 'ansi16') codes.push(rgbToAnsi16(ansi256ToRgb(opts.color)));
      else if (level === 'truecolor') codes.push(38, 2, ...(dynamic?.rgb ?? ansi256ToRgb(opts.color)));
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
