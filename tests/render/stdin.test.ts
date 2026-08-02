import { describe, it, expect } from 'vitest';
import { renderSnapshot } from '../../src/render/stdin';
import { stripAnsi } from '../../src/render/ansi';
import { normalizeTermWidth } from '../../src/render/context';
import type { Settings } from '../../src/types';

const plainSettings: Settings = {
  refreshInterval: 1000, colorLevel: 'truecolor', powerline: { enabled: false, separator: '', separatorReverse: '' },
  openrouter: { weeklyBudgetUsd: 25 },
  lines: [[{ type: 'custom-text', text: 'safe' }, { type: 'separator' }, { type: 'custom-symbol', symbol: '★' }]],
};

describe('render --stdin', () => {
  it('renders the versioned snapshot as plain lines', () => {
    const output = renderSnapshot({ version: 1, model: 'qwen3-coder', cwd: '/missing', cost: 0.04, context: { tokens: 6553, limit: 65536 }, termWidth: 120, git: { isRepo: true, branch: 'main' } });
    expect(output).toContain('qwen3-coder');
    expect(output).toContain('ctx 10%');
    expect(output).toContain('$0.04');
    expect(output).not.toMatch(/\x1b\[[0-?]*[ -\/]*[@-~]/);
    expect(output.endsWith('\n')).toBe(true);
  });
  it('accepts snapshots without an optional version', () => {
    expect(renderSnapshot({ model: 'model' })).toContain('model');
  });
  it('gracefully renders missing optional fields', () => {
    expect(renderSnapshot({ version: 1, model: 'model' })).toContain('model');
  });
  it('removes non-SGR ANSI and OSC sequences from custom output', () => {
    const output = renderSnapshot({ version: 1 }, {
      ...plainSettings,
      lines: [[{ type: 'custom-text', text: '\x1b[2J\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\' }]],
    });
    expect(output).toBe('link\n');
    expect(output).toBe(stripAnsi(output));
  });
  it('uses tokens.total when component totals are absent', () => {
    const output = renderSnapshot({ version: 1, tokens: { total: 1234 } }, {
      ...plainSettings,
      lines: [[{ type: 'tokens' }]],
    });
    expect(output).toBe('1.2k\n');
  });
  it('keeps context tokens separate from session token aggregation', () => {
    const output = renderSnapshot({ version: 1, tokens: { input: 100, output: 20, reasoning: 5, cacheRead: 10, cacheWrite: 2 }, context: { tokens: 900 } }, {
      ...plainSettings,
      lines: [[{ type: 'tokens' }, { type: 'separator' }, { type: 'context-length' }]],
    });
    expect(output).toBe('125 · 900\n');
  });
  it('falls back for invalid terminal widths', () => {
    expect(normalizeTermWidth(0)).toBe(120);
    expect(normalizeTermWidth(-10)).toBe(120);
    expect(normalizeTermWidth(Number.NaN)).toBe(120);
    expect(normalizeTermWidth('80')).toBe(120);
    expect(normalizeTermWidth(80)).toBe(80);
  });
  it('rejects malformed snapshot values', () => {
    expect(() => renderSnapshot(null)).toThrow('stdin must contain one JSON object');
    expect(() => renderSnapshot({ version: 2 })).toThrow('unsupported ocstatusline snapshot version');
  });
});
