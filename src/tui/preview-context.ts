import { emptyState, type RenderContext } from '../types/index.js';

// Representative sample data so the preview matches what the daemon would draw.
// contextTokens/contextLimit = 27525/65536 ≈ 42%; sessionDurationMs 192000 = 3m12s.
export function mockContext(): RenderContext {
  return {
    state: emptyState(),
    derived: {
      model: 'qwen3-coder', provider: 'ollama', mode: 'build', cwd: '/home/u/proj',
      totalTokens: 27575, contextTokens: 27525, contextLimit: 65536, cost: 0.12, sessionDurationMs: 192000,
    },
    git: { isRepo: true, branch: 'main', dirty: true, ahead: 0, behind: 0, changes: 3, sha: 'abc1234' },
    termWidth: 80,
    now: 0,
    openrouterWeekly: { source: null, balanceUsd: null, budgetUsd: 25, spentUsd: 0, remainingUsd: 25, windowStartMs: 0, windowEndMs: 0 },
  };
}
