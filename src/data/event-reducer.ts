import type { OpencodeState, MsgAgg } from '../types/index.js';
import { zeroTokens } from '../types/index.js';

export function reduce(state: OpencodeState, event: any): OpencodeState {
  const type: string = event?.type;
  if (type === 'message.updated') {
    const info = event.properties?.info;
    if (!info || info.role !== 'assistant') return state;
    const t = info.tokens ?? {};
    const cache = t.cache ?? {};
    const agg: MsgAgg = {
      role: 'assistant',
      cost: typeof info.cost === 'number' ? info.cost : 0,
      tokens: {
        input: t.input ?? 0, output: t.output ?? 0, reasoning: t.reasoning ?? 0,
        cacheRead: cache.read ?? 0, cacheWrite: cache.write ?? 0,
      },
      modelID: info.modelID, providerID: info.providerID, mode: info.mode,
      cwd: info.path?.cwd, created: info.time?.created ?? Date.now(),
    };
    const byMessage = { ...state.byMessage, [info.id]: agg };
    const sessionStart = state.sessionStart === null ? agg.created : Math.min(state.sessionStart, agg.created);
    return { ...state, byMessage, latestAssistantID: info.id, sessionStart, idle: false, lastUpdate: Date.now() };
  }
  if (type === 'session.idle') return { ...state, idle: true, lastUpdate: Date.now() };
  if (type === 'session.error') return { ...state, idle: true, lastUpdate: Date.now() };
  return state;
}

export { zeroTokens };
