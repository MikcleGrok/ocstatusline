import { connect, subscribeEvents } from './data/server.js';
import { reduce } from './data/event-reducer.js';
import { loadLimitLookup } from './data/models.js';
import { renderLines } from './render/renderer.js';
import { buildRenderContext } from './render/context.js';
import { repaint } from './render/ansi.js';
import { loadSettings } from './utils/config.js';
import { emptyState, type OpencodeState } from './types/index.js';
import { fetchOpenRouterBalanceWithSource } from './tui/openrouter.js';
import { updateWeeklyState } from './data/openrouter-weekly.js';
import type { OpenRouterWeeklyContext } from './types/index.js';

let prevLineCount = 0;

function paint(state: OpencodeState, settings: ReturnType<typeof loadSettings>, getLimit: ReturnType<typeof loadLimitLookup>, openrouterWeekly: OpenRouterWeeklyContext) {
  const ctx = buildRenderContext(state, getLimit, { openrouterWeekly });
  const lines = renderLines(ctx, settings);
  process.stdout.write(repaint(lines, prevLineCount));
  prevLineCount = lines.length;
}

export async function runDaemon(opts: { serverUrl?: string; timeoutMs?: number }): Promise<void> {
  const settings = loadSettings();
  const getLimit = loadLimitLookup();
  const serverUrl = opts.serverUrl;
  const timeoutMs = opts.timeoutMs;
  let state = emptyState();
  let openrouterWeekly = updateWeeklyState(null, settings.openrouter.weeklyBudgetUsd, Date.now());
  const refreshBalance = async () => {
    const balance = await fetchOpenRouterBalanceWithSource();
    openrouterWeekly = updateWeeklyState(balance, settings.openrouter.weeklyBudgetUsd, Date.now(), openrouterWeekly);
    paint(state, settings, getLimit, openrouterWeekly);
  };

  const conn = await connect(serverUrl);
  if (!serverUrl) {
    process.stderr.write(`ocstatusline: managed server at ${conn.serverUrl}\n`);
    process.stderr.write(`  attach your session with: opencode attach ${conn.serverUrl}\n`);
  }
  state = { ...state, connected: true };

  const stop = await subscribeEvents(conn.client, (ev) => {
    state = reduce(state, ev);
    paint(state, settings, getLimit, openrouterWeekly);
  });

  const tick = setInterval(() => paint(state, settings, getLimit, openrouterWeekly), settings.refreshInterval);
  const balanceTick = setInterval(refreshBalance, 60_000);
  void refreshBalance();
  paint(state, settings, getLimit, openrouterWeekly);

  const shutdown = () => { clearInterval(tick); clearInterval(balanceTick); stop(); conn.close(); process.stdout.write('\n'); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (timeoutMs && timeoutMs > 0) {
    setTimeout(shutdown, timeoutMs);
  }
}
