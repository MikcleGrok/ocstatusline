import { describe, it, expect } from 'vitest';
import { repaint } from '../../src/render/ansi';

describe('repaint', () => {
  it('first paint (no prior lines): just CR + clear-below + text', () => {
    expect(repaint(['hello'], 0)).toBe('\r\x1b[0Jhello');
  });
  it('repaint single line (prev 1): no cursor-up move', () => {
    expect(repaint(['hello'], 1)).toBe('\r\x1b[0Jhello');
  });
  it('repaint multi-line: moves cursor up prev-1 lines, clears below, rewrites', () => {
    expect(repaint(['a', 'b'], 2)).toBe('\r\x1b[1A\x1b[0Ja\nb');
  });
  it('shrinking render still clears all previous lines (clear-below removes leftovers)', () => {
    expect(repaint(['x'], 3)).toBe('\r\x1b[2A\x1b[0Jx');
  });
});
