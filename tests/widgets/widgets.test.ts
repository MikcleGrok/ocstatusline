import { describe, it, expect } from 'vitest';
import { WIDGETS } from '../../src/widgets/index';
import type { RenderContext } from '../../src/types/index';
import { emptyState } from '../../src/types/index';

function ctx(over: Partial<RenderContext> = {}): RenderContext {
  return {
    state: emptyState(),
    derived: { model: 'qwen3-coder', provider: 'ollama', mode: 'build', cwd: '/home/u/proj',
      totalTokens: 1234, contextTokens: 6553, contextLimit: 65536, cost: 0.042, sessionDurationMs: 192000 },
    git: { isRepo: true, branch: 'main', dirty: true, ahead: 2, behind: 0, changes: 3, sha: 'abcdef1' },
    termWidth: 120, now: 0,
    openrouterWeekly: { source: null, balanceUsd: null, budgetUsd: 25, spentUsd: 0, remainingUsd: 25, windowStartMs: 0, windowEndMs: 0 },
    ...over,
  };
}

describe('widgets', () => {
  it('model strips context suffix', () => {
    expect(WIDGETS['model'].render(ctx(), { type: 'model' })).toBe('qwen3-coder');
  });
  it('provider and mode', () => {
    expect(WIDGETS['provider'].render(ctx(), { type: 'provider' })).toBe('ollama');
    expect(WIDGETS['mode'].render(ctx(), { type: 'mode' })).toBe('build');
  });
  it('cost formats USD', () => {
    expect(WIDGETS['cost'].render(ctx(), { type: 'cost' })).toBe('$0.04');
  });
  it('context-percentage', () => {
    expect(WIDGETS['context-percentage'].render(ctx(), { type: 'context-percentage' })).toBe('ctx 10%');
  });
  it('context-percentage hidden when no limit', () => {
    const c = ctx(); c.derived.contextLimit = null;
    expect(WIDGETS['context-percentage'].render(c, { type: 'context-percentage' })).toBeNull();
  });
  it('session-timer formats m:ss', () => {
    expect(WIDGETS['session-timer'].render(ctx(), { type: 'session-timer' })).toBe('3m12s');
  });
  it('git-branch shows branch with dirty marker', () => {
    expect(WIDGETS['git-branch'].render(ctx(), { type: 'git-branch' })).toBe('main*');
  });
  it('git-branch hidden outside repo', () => {
    const c = ctx(); c.git.isRepo = false;
    expect(WIDGETS['git-branch'].render(c, { type: 'git-branch' })).toBeNull();
  });
  it('git-ahead-behind', () => {
    expect(WIDGETS['git-ahead-behind'].render(ctx(), { type: 'git-ahead-behind' })).toBe('↑2');
  });
  it('cwd basename', () => {
    expect(WIDGETS['cwd'].render(ctx(), { type: 'cwd' })).toBe('proj');
  });
  it('tokens total formats k', () => {
    expect(WIDGETS['tokens'].render(ctx(), { type: 'tokens' })).toBe('1.2k');
  });
  it('custom-text echoes its text', () => {
    expect(WIDGETS['custom-text'].render(ctx(), { type: 'custom-text', text: 'hi' })).toBe('hi');
  });
  it('formats the weekly balance and countdown only for account source', () => {
    const c = ctx({ now: 0, openrouterWeekly: { source: 'account', balanceUsd: 10, budgetUsd: 25, spentUsd: 15, remainingUsd: 10, windowStartMs: 0, windowEndMs: 4 * 86400000 + 2 * 3600000 } });
    expect(WIDGETS['openrouter-weekly'].render(c, { type: 'openrouter-weekly' })).toBe('$10.00 4d2h');
    c.openrouterWeekly = { ...c.openrouterWeekly, source: 'key-limit' };
    expect(WIDGETS['openrouter-weekly'].render(c, { type: 'openrouter-weekly' })).toBeNull();
  });
  it('formats the countdown boundaries', () => {
    const c = ctx({ now: 0, openrouterWeekly: { source: 'account', balanceUsd: 1, budgetUsd: 25, spentUsd: 24, remainingUsd: 1, windowStartMs: 0, windowEndMs: 45 * 60000 } });
    expect(WIDGETS['openrouter-weekly'].render(c, { type: 'openrouter-weekly' })).toBe('$1.00 45m');
    c.openrouterWeekly = { ...c.openrouterWeekly, windowEndMs: 0 };
    expect(WIDGETS['openrouter-weekly'].render(c, { type: 'openrouter-weekly' })).toBe('$1.00 now');
  });
  it('uses an unambiguous countdown for a positive remainder under one minute', () => {
    const c = ctx({ now: 0, openrouterWeekly: { source: 'account', balanceUsd: 1, budgetUsd: 25, spentUsd: 24, remainingUsd: 1, windowStartMs: 0, windowEndMs: 59999 } });
    expect(WIDGETS['openrouter-weekly'].render(c, { type: 'openrouter-weekly' })).toBe('$1.00 now');
    c.openrouterWeekly = { ...c.openrouterWeekly, windowEndMs: 60000 };
    expect(WIDGETS['openrouter-weekly'].render(c, { type: 'openrouter-weekly' })).toBe('$1.00 1m');
  });
});
