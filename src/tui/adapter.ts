import { loadLimitLookup } from '../data/models.js';
import { buildRenderContext } from '../render/context.js';
import { stripAnsi } from '../render/ansi.js';
import { renderLines } from '../render/renderer.js';
import { emptyState, type MsgAgg, type OpencodeState, type Settings } from '../types/index.js';

export interface TuiRouteLike {
  name?: unknown;
  params?: { sessionID?: unknown } | Record<string, unknown>;
}

export interface TuiAssistantMessage {
  id?: unknown;
  sessionID?: unknown;
  role?: unknown;
  time?: { created?: unknown };
  cost?: unknown;
  modelID?: unknown;
  providerID?: unknown;
  mode?: unknown;
  path?: { cwd?: unknown };
  tokens?: { input?: unknown; output?: unknown; reasoning?: unknown; total?: unknown; cache?: { read?: unknown; write?: unknown } };
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function sessionIDFromRoute(route: TuiRouteLike | undefined): string | null {
  if (route?.name !== 'session') return null;
  const sessionID = route.params?.sessionID;
  return typeof sessionID === 'string' && sessionID.length > 0 ? sessionID : null;
}

export function assistantMessageToAgg(message: TuiAssistantMessage): MsgAgg | null {
  if (message.role !== 'assistant' || typeof message.id !== 'string') return null;
  const tokens = message.tokens ?? {};
  const cache = tokens.cache ?? {};
  return {
    role: 'assistant',
    cost: finite(message.cost),
    tokens: {
      input: finite(tokens.input),
      output: finite(tokens.output),
      reasoning: finite(tokens.reasoning),
      cacheRead: finite(cache.read),
      cacheWrite: finite(cache.write),
      total: typeof tokens.total === 'number' && Number.isFinite(tokens.total) ? tokens.total : undefined,
    },
    modelID: typeof message.modelID === 'string' ? message.modelID : undefined,
    providerID: typeof message.providerID === 'string' ? message.providerID : undefined,
    mode: typeof message.mode === 'string' ? message.mode : undefined,
    cwd: typeof message.path?.cwd === 'string' ? message.path.cwd : undefined,
    created: finite(message.time?.created, Date.now()),
  };
}

export function stateFromTuiMessages(messages: readonly TuiAssistantMessage[], sessionID: string, status: unknown, now: number): OpencodeState {
  const state = emptyState();
  const byMessage: Record<string, MsgAgg> = {};
  let latest: { id: string; created: number } | null = null;
  let sessionStart: number | null = null;
  for (const message of messages) {
    if (message.sessionID !== sessionID) continue;
    const agg = assistantMessageToAgg(message);
    if (!agg || typeof message.id !== 'string') continue;
    byMessage[message.id] = agg;
    sessionStart = sessionStart === null ? agg.created : Math.min(sessionStart, agg.created);
    if (!latest || agg.created >= latest.created) latest = { id: message.id, created: agg.created };
  }
  state.connected = true;
  state.idle = status === 'idle' || status === 'error' || status === 'completed';
  state.byMessage = byMessage;
  state.latestAssistantID = latest?.id ?? null;
  state.sessionStart = sessionStart;
  state.lastUpdate = now;
  return state;
}

export function renderTuiFooter(route: TuiRouteLike | undefined, messages: readonly TuiAssistantMessage[], status: unknown, settings: Settings, now: number, termWidth?: unknown): string {
  const sessionID = sessionIDFromRoute(route);
  if (!sessionID) return '';
  const state = stateFromTuiMessages(messages, sessionID, status, now);
  const context = buildRenderContext(state, loadLimitLookup(), { now, termWidth });
  return stripAnsi(renderLines(context, settings)[0] ?? '');
}
