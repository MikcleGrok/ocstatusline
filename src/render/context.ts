import { derive, type LimitLookup } from '../data/selectors.js';
import { getGitInfo } from '../data/git.js';
import type { GitInfo, OpencodeState, RenderContext } from '../types/index.js';

export function normalizeTermWidth(value: unknown, fallback = 120): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : fallback;
}

export function buildRenderContext(state: OpencodeState, getLimit: LimitLookup, opts: { now?: number; termWidth?: unknown; git?: GitInfo } = {}): RenderContext {
  const now = opts.now ?? Date.now();
  const derived = derive(state, getLimit, now);
  const git = opts.git ?? getGitInfo(derived.cwd);
  const termWidth = normalizeTermWidth(opts.termWidth, normalizeTermWidth(process.stdout.columns));
  return { state, derived, git, termWidth, now };
}
