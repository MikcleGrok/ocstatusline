import { describe, it, expect } from 'vitest';
import { renderLines } from '../../src/render/renderer';
import type { RenderContext, Settings } from '../../src/types/index';
import { emptyState } from '../../src/types/index';
import { stripAnsi } from '../../src/render/ansi';
import { defaultSettings } from '../../src/utils/config';

function ctx(): RenderContext {
  return {
    state: emptyState(),
    derived: { model: 'qwen3-coder', provider: 'ollama', mode: 'build', cwd: '/p/proj',
      totalTokens: 0, contextTokens: 6553, contextLimit: 65536, cost: 0.04, sessionDurationMs: 192000 },
    git: { isRepo: true, branch: 'main', dirty: false, ahead: 0, behind: 0, changes: 0, sha: 'abc1234' },
    termWidth: 200, now: 0,
    openrouterWeekly: { source: null, balanceUsd: null, budgetUsd: 25, spentUsd: 0, remainingUsd: 25, windowStartMs: 0, windowEndMs: 0 },
  };
}
const settings: Settings = {
  refreshInterval: 1000, colorLevel: 'ansi16',
  openrouter: { weeklyBudgetUsd: 25 },
  powerline: { enabled: false, separator: '|', separatorReverse: '|' },
  lines: [[
    { type: 'model', color: 'cyan' }, { type: 'separator' },
    { type: 'git-branch' }, { type: 'separator' },
    { type: 'context-percentage' }, { type: 'separator' }, { type: 'cost' },
  ]],
};

describe('renderLines', () => {
  it('renders a single line with separators, hidden widgets collapsed', () => {
    const [line] = renderLines(ctx(), settings);
    expect(stripAnsi(line)).toBe('qwen3-coder · main · ctx 10% · $0.04');
  });
  it('renders mode in the default status line and hides it when unavailable', () => {
    const defaultLine = stripAnsi(renderLines(ctx(), defaultSettings())[0]);
    expect(defaultLine).toContain('build');

    const missingMode = ctx();
    missingMode.derived.mode = null;
    expect(stripAnsi(renderLines(missingMode, defaultSettings())[0])).not.toContain('build');
  });
  it('renders the production version in the default status line', () => {
    const c = { ...ctx(), productionVersion: '2026.08.04' };
    expect(stripAnsi(renderLines(c, defaultSettings())[0])).toContain('prod 2026.08.04');
  });
  it('omits empty widgets and their separators', () => {
    const c = ctx(); c.git.isRepo = false; // git-branch hidden
    const [line] = renderLines(c, settings);
    expect(stripAnsi(line)).toBe('qwen3-coder · ctx 10% · $0.04');
  });
  it('fits to terminal width', () => {
    const c = ctx(); c.termWidth = 12;
    const [line] = renderLines(c, settings);
    expect(stripAnsi(line).length).toBeLessThanOrEqual(12);
  });
  it('uses threshold colors only for the weekly widget', () => {
    const weekly = { ...settings, colorLevel: 'ansi256' as const, lines: [[{ type: 'openrouter-weekly' }]] };
    const low = { ...ctx(), now: 500, openrouterWeekly: { source: 'account' as const, balanceUsd: 2, budgetUsd: 25, spentUsd: 20, remainingUsd: 5, windowStartMs: 0, windowEndMs: 1000 } };
    expect(renderLines(low, weekly)[0]).toContain('38;5;124');
    low.openrouterWeekly = { ...low.openrouterWeekly, spentUsd: 15, remainingUsd: 10 };
    expect(renderLines(low, weekly)[0]).toContain('38;5;208');
    low.openrouterWeekly = { ...low.openrouterWeekly, spentUsd: 5, remainingUsd: 20 };
    expect(renderLines(low, weekly)[0]).toContain('38;5;75');
    low.openrouterWeekly = { ...low.openrouterWeekly, spentUsd: 26.25, remainingUsd: 0 };
    expect(renderLines(low, weekly)[0]).toContain('38;5;201');
    expect(stripAnsi(renderLines(low, weekly)[0])).toContain('-$1.25');
  });
  it('renders an invalid weekly burn rate neutrally', () => {
    const weekly = { ...settings, colorLevel: 'ansi256' as const, lines: [[{ type: 'openrouter-weekly', color: 124 }]] };
    const invalid = { ...ctx(), openrouterWeekly: { source: 'account' as const, balanceUsd: 2, budgetUsd: 25, spentUsd: 2, remainingUsd: 23, windowStartMs: Number.NaN, windowEndMs: 100 } };
    expect(renderLines(invalid, weekly)[0]).toContain('\x1b[37m');
    expect(renderLines(invalid, weekly)[0]).not.toContain('38;5;124');
  });
  it('passes numeric widget colors through the public pipeline', () => {
    const numericColor: Settings = { ...settings, colorLevel: 'ansi256', lines: [[{ type: 'model', color: 124 }]] };
    expect(renderLines(ctx(), numericColor)[0]).toContain('38;5;124');
  });
  it('renders distinct threshold escapes at every color level', () => {
    const low = { ...ctx(), now: 500, openrouterWeekly: { source: 'account' as const, balanceUsd: 2, budgetUsd: 25, spentUsd: 20, remainingUsd: 5, windowStartMs: 0, windowEndMs: 1000 } };
     for (const [colorLevel, critical, warning, healthy, overBudget] of [
       ['ansi16', '\x1b[31m', '\x1b[33m', '\x1b[34m', '\x1b[35m'],
       ['ansi256', '38;5;124', '38;5;208', '38;5;75', '38;5;201'],
       ['truecolor', '38;2;175;0;0', '38;2;255;0;0', '38;2;95;175;215', '38;2;220;20;60'],
     ] as const) {
      const weekly = { ...settings, colorLevel, lines: [[{ type: 'openrouter-weekly' }]] };
      const criticalLine = renderLines(low, weekly)[0];
      low.openrouterWeekly = { ...low.openrouterWeekly, spentUsd: 15, remainingUsd: 10 };
      const warningLine = renderLines(low, weekly)[0];
      expect(criticalLine).toContain(critical);
      expect(warningLine).toContain(warning);
      low.openrouterWeekly = { ...low.openrouterWeekly, spentUsd: 5, remainingUsd: 20 };
       expect(renderLines(low, weekly)[0]).toContain(healthy);
       low.openrouterWeekly = { ...low.openrouterWeekly, spentUsd: 26.25, remainingUsd: 0 };
       expect(renderLines(low, weekly)[0]).toContain(overBudget);
      expect(criticalLine).not.toBe(warningLine);
      low.openrouterWeekly = { ...low.openrouterWeekly, spentUsd: 20, remainingUsd: 5 };
    }
  });
});
