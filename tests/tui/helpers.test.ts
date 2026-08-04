import { describe, it, expect } from 'vitest';
import { mockContext } from '../../src/tui/preview-context';
import { availableWidgets } from '../../src/tui/widget-catalog';
import { renderLines } from '../../src/render/renderer';
import { defaultSettings } from '../../src/utils/config';
import { stripAnsi } from '../../src/render/ansi';

describe('mockContext', () => {
  it('renders the default settings to the representative line', () => {
    const [line] = renderLines(mockContext(), defaultSettings());
    expect(stripAnsi(line)).toBe('qwen3-coder · build · main* · ctx 42% · $0.12 · 3m12s');
  });
});

describe('availableWidgets', () => {
  it('includes real widgets and excludes the separator placeholder', () => {
    const types = availableWidgets().map(w => w.type);
    expect(types).toContain('model');
    expect(types).toContain('git-branch');
    expect(types).not.toContain('separator');
  });
  it('each entry has a non-empty label', () => {
    expect(availableWidgets().every(w => w.label.length > 0)).toBe(true);
  });
});
