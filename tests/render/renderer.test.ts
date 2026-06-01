import { describe, it, expect } from 'vitest';
import { renderLines } from '../../src/render/renderer';
import type { RenderContext, Settings } from '../../src/types/index';
import { emptyState } from '../../src/types/index';
import { stripAnsi } from '../../src/render/ansi';

function ctx(): RenderContext {
  return {
    state: emptyState(),
    derived: { model: 'qwen3-coder', provider: 'ollama', mode: 'build', cwd: '/p/proj',
      totalTokens: 0, contextTokens: 6553, contextLimit: 65536, cost: 0.04, sessionDurationMs: 192000 },
    git: { isRepo: true, branch: 'main', dirty: false, ahead: 0, behind: 0, changes: 0, sha: 'abc1234' },
    termWidth: 200, now: 0,
  };
}
const settings: Settings = {
  refreshInterval: 1000, colorLevel: 'ansi16',
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
});
