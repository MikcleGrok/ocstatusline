import type { OpencodeState, Derived } from '../types/index.js';

export type LimitLookup = (provider: string | null, model: string | null) => number | null;

export function derive(state: OpencodeState, getLimit: LimitLookup, now: number): Derived {
  const latest = state.latestAssistantID ? state.byMessage[state.latestAssistantID] : undefined;
  const model = latest?.modelID ?? null;
  const provider = latest?.providerID ?? null;
  const mode = latest?.mode ?? null;
  const cwd = latest?.cwd ?? null;

  let cost = 0, totalTokens = 0;
  for (const id of Object.keys(state.byMessage)) {
    const m = state.byMessage[id];
    cost += m.cost;
    totalTokens += m.tokens.total ?? m.tokens.input + m.tokens.output + m.tokens.reasoning;
  }
  const contextTokens = latest?.contextTokens ?? (latest ? latest.tokens.input + latest.tokens.cacheRead + latest.tokens.cacheWrite : 0);
  const contextLimit = getLimit(provider, model);
  const sessionDurationMs = state.sessionStart === null ? 0 : Math.max(0, now - state.sessionStart);

  return { model, provider, mode, cwd, totalTokens, contextTokens, contextLimit, cost, sessionDurationMs };
}
