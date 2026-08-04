import { describe, it, expect } from 'vitest';
import { renderLines } from '../../src/render/renderer';
import { mockContext } from '../../src/tui/preview-context';
import { defaultSettings } from '../../src/utils/config';
import { normalizeLine } from '../helpers/normalize';
import type { Settings } from '../../src/types/index';

function powerlineSettings(): Settings {
  const s = defaultSettings();
  return { ...s, powerline: { enabled: true, separator: '', separatorReverse: '' } };
}

describe('normalizeLine', () => {
  it('drops ANSI escapes', () => {
    expect(normalizeLine('\x1b[36mmodel\x1b[0m')).toBe('model');
  });
  it('replaces a m:ss timer', () => {
    expect(normalizeLine('3m12s')).toBe('<timer>');
  });
  it('replaces an h:mm timer', () => {
    expect(normalizeLine('27h04m')).toBe('<timer>');
  });
});

describe('golden rendering', () => {
  it('renders the default settings to the documented representative line', () => {
    const [line] = renderLines(mockContext(), defaultSettings());
    expect(normalizeLine(line)).toBe('qwen3-coder · build · main* · ctx 42% · $0.12 · <timer>');
  });

  it('renders the same line byte-for-byte on a repeat render', () => {
    const a = renderLines(mockContext(), defaultSettings());
    const b = renderLines(mockContext(), defaultSettings());
    expect(a).toEqual(b);
  });

  it('renders the Powerline variant to a committed snapshot', () => {
    const [line] = renderLines(mockContext(), powerlineSettings());
    expect(normalizeLine(line)).toMatchSnapshot();
  });

  it('never exceeds the terminal width it is given', () => {
    for (const width of [20, 40, 80, 120]) {
      const ctx = { ...mockContext(), termWidth: width };
      for (const line of renderLines(ctx, defaultSettings())) {
        expect(normalizeLine(line).length).toBeLessThanOrEqual(width);
      }
    }
  });

  it('runs with the pinned terminal width (make test is the only sanctioned runner)', () => {
    expect(process.env.COLUMNS).toBe('120');
  });
});
