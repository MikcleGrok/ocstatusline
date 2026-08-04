import { derive, type LimitLookup } from '../data/selectors.js';
import { getGitInfo } from '../data/git.js';
import { readProjectStatusCachedSync } from '../data/project-status.js';
import type { GitInfo, OpencodeState, OpenRouterWeeklyContext, RenderContext } from '../types/index.js';

export const emptyOpenRouterWeekly: OpenRouterWeeklyContext = {
  source: null, balanceUsd: null, budgetUsd: 25, spentUsd: 0, remainingUsd: 25, windowStartMs: 0, windowEndMs: 0,
};

export function normalizeTermWidth(value: unknown, fallback = 120): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : fallback;
}

export function buildRenderContext(state: OpencodeState, getLimit: LimitLookup, opts: { now?: number; termWidth?: unknown; git?: GitInfo; openrouterWeekly?: OpenRouterWeeklyContext; productionVersion?: string | null } = {}): RenderContext {
  const now = opts.now ?? Date.now();
  const derived = derive(state, getLimit, now);
  const git = opts.git ?? getGitInfo(derived.cwd);
  const termWidth = normalizeTermWidth(opts.termWidth, normalizeTermWidth(process.stdout.columns));
  return { state, derived, git, termWidth, now, openrouterWeekly: opts.openrouterWeekly ?? emptyOpenRouterWeekly, productionVersion: opts.productionVersion === undefined ? readProjectStatusCachedSync(derived.cwd).productionVersion : opts.productionVersion };
}
