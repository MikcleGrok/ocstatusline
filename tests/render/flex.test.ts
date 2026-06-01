import { describe, it, expect } from 'vitest';
import { fitWidth } from '../../src/render/flex';
import { stripAnsi } from '../../src/render/ansi';

describe('fitWidth', () => {
  it('returns line unchanged when it fits', () => {
    expect(fitWidth('abc def', 20)).toBe('abc def');
  });
  it('truncates with ellipsis when too wide', () => {
    const out = fitWidth('abcdefghij', 5);
    expect(stripAnsi(out).length).toBeLessThanOrEqual(5);
    expect(out.endsWith('…')).toBe(true);
  });
  it('measures visible width ignoring ANSI', () => {
    const colored = '\x1b[31mabc\x1b[0m';
    expect(fitWidth(colored, 10)).toBe(colored);
  });
});
