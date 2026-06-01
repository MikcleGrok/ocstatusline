import { describe, it, expect } from 'vitest';
import { joinPowerline, joinPlain } from '../../src/render/powerline';

describe('powerline/join', () => {
  it('joinPlain inserts separators between non-empty segments', () => {
    expect(joinPlain(['a', '', 'b'], ' | ')).toBe('a | b');
  });
  it('joinPlain collapses around empty segments (no dangling separators)', () => {
    expect(joinPlain(['', 'a', '', '', 'b', ''], ' ')).toBe('a b');
  });
  it('joinPowerline places the separator glyph between segments', () => {
    const out = joinPowerline(['a', 'b'], '');
    expect(out).toContain('a');
    expect(out).toContain('');
    expect(out).toContain('b');
  });
});
