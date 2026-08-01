import { loadLimitLookup } from '../data/models.js';
import { renderLines } from './renderer.js';
import { stripAnsi } from './ansi.js';
import { buildRenderContext } from './context.js';
import { emptyState, type GitInfo, type MsgAgg, type OpencodeState } from '../types/index.js';
import { loadSettings } from '../utils/config.js';
import { normalizeTermWidth } from './context.js';

export interface OcstatuslineSnapshot {
  version?: number;
  model?: string;
  provider?: string;
  mode?: string;
  cwd?: string;
  tokens?: { input?: number; output?: number; reasoning?: number; cacheRead?: number; cacheWrite?: number; total?: number };
  context?: { tokens?: number; limit?: number };
  cost?: number;
  sessionDurationMs?: number;
  termWidth?: number;
  git?: Partial<GitInfo>;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function snapshotState(snapshot: OcstatuslineSnapshot, now: number): OpencodeState {
  const tokens = snapshot.tokens ?? {};
  const input = numberOr(tokens.input, 0);
  const output = numberOr(tokens.output, 0);
  const reasoning = numberOr(tokens.reasoning, 0);
  const cacheRead = numberOr(tokens.cacheRead, 0);
  const cacheWrite = numberOr(tokens.cacheWrite, 0);
  const contextTokens = numberOr(snapshot.context?.tokens, input + cacheRead + cacheWrite);
  const msg: MsgAgg = {
    role: 'assistant',
    cost: numberOr(snapshot.cost, 0),
    tokens: { input, output, reasoning, cacheRead, cacheWrite, total: numberOr(tokens.total, input + output + reasoning) },
    contextTokens: snapshot.context?.tokens === undefined ? undefined : contextTokens,
    modelID: typeof snapshot.model === 'string' ? snapshot.model : undefined,
    providerID: typeof snapshot.provider === 'string' ? snapshot.provider : undefined,
    mode: typeof snapshot.mode === 'string' ? snapshot.mode : undefined,
    cwd: typeof snapshot.cwd === 'string' ? snapshot.cwd : undefined,
    created: now,
  };
  const state = emptyState();
  state.connected = true;
  state.latestAssistantID = 'stdin';
  state.byMessage.stdin = msg;
  state.sessionStart = now - Math.max(0, numberOr(snapshot.sessionDurationMs, 0));
  state.lastUpdate = now;
  return state;
}

function normalizeGit(git: Partial<GitInfo> | undefined): GitInfo {
  if (!git || typeof git !== 'object') return { isRepo: false, branch: null, dirty: false, ahead: 0, behind: 0, changes: 0, sha: null };
  return {
    isRepo: git.isRepo === true,
    branch: typeof git.branch === 'string' ? git.branch : null,
    dirty: git.dirty === true,
    ahead: numberOr(git.ahead, 0),
    behind: numberOr(git.behind, 0),
    changes: numberOr(git.changes, 0),
    sha: typeof git.sha === 'string' ? git.sha : null,
  };
}

export function renderSnapshot(snapshot: unknown, settings = loadSettings()): string {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('stdin must contain one JSON object');
  const input = snapshot as OcstatuslineSnapshot;
  if (input.version !== undefined && input.version !== 1) throw new Error('unsupported ocstatusline snapshot version');
  const now = Date.now();
  const state = snapshotState(input, now);
  const limits = loadLimitLookup();
  const getLimit = input.context?.limit !== undefined ? () => numberOr(input.context?.limit, 0) : limits;
  const ctx = buildRenderContext(state, getLimit, { now, termWidth: normalizeTermWidth(input.termWidth), git: normalizeGit(input.git) });
  const lines = renderLines(ctx, settings).map(stripAnsi);
  return `${lines.join('\n')}\n`;
}

export async function runStdinRender(): Promise<void> {
  const raw = await Bun.stdin.text();
  process.stdout.write(renderSnapshot(JSON.parse(raw)));
}
