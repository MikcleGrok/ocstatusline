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
  it('supports ANSI-256 numeric colors', () => {
    expect(colorize('x', { color: 124 }, 'ansi256')).toContain('38;5;124');
  });
  it('maps dynamic numeric colors to truecolor', () => {
    expect(colorize('x', { color: 124 }, 'truecolor')).toContain('38;2;175;0;0');
    expect(colorize('x', { color: 33 }, 'truecolor')).toContain('38;2;0;135;255');
  });
  it('maps dynamic numeric colors distinctly in ANSI-16', () => {
    expect(colorize('x', { color: 124 }, 'ansi16')).toContain('\x1b[31m');
    expect(colorize('x', { color: 33 }, 'ansi16')).toContain('\x1b[33m');
    expect(colorize('x', { color: 124 }, 'ansi16')).not.toBe(colorize('x', { color: 33 }, 'ansi16'));
  });
  it('keeps distinct exact ANSI-256 dynamic colors', () => {
    expect(colorize('x', { color: 124 }, 'ansi256')).toContain('38;5;124');
    expect(colorize('x', { color: 33 }, 'ansi256')).toContain('38;5;33');
  });
});
