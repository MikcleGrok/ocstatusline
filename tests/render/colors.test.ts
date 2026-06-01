import { describe, it, expect } from 'vitest';
import { colorize } from '../../src/render/colors';

describe('colorize', () => {
  it('wraps text in SGR and resets', () => {
    const out = colorize('hi', { color: 'red' }, 'ansi16');
    expect(out.startsWith('\x1b[')).toBe(true);
    expect(out.endsWith('\x1b[0m')).toBe(true);
    expect(out).toContain('hi');
  });
  it('applies bold', () => {
    expect(colorize('x', { color: 'red', bold: true }, 'ansi16')).toContain('1;');
  });
  it('truecolor uses 38;2;r;g;b for hex', () => {
    expect(colorize('x', { color: '#10203f' }, 'truecolor')).toContain('38;2;16;32;63');
  });
  it('no color → returns text unchanged', () => {
    expect(colorize('plain', {}, 'truecolor')).toBe('plain');
  });
});
