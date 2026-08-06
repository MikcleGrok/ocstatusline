import { describe, expect, it } from 'vitest';
import { tuiTextColor } from '../../.opencode/tui-plugins/ocstatusline.js';

describe('OpenTUI color boundary', () => {
  it('converts every formatter ANSI-256 color to an OpenTUI RGBA value', () => {
    for (const color of [75, 37, 71, 208, 124, 201]) {
      const result = tuiTextColor(color);
      expect(result.constructor.name).toBe('RGBA');
      expect(result).toHaveProperty('buffer', expect.any(Uint16Array));
      expect(typeof result).not.toBe('number');
    }
  });

  it('passes named string colors through unchanged', () => {
    expect(tuiTextColor('gray')).toBe('gray');
  });
});
