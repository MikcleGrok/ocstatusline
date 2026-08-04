import { connect, subscribeEvents } from './data/server.js';
import { reduce } from './data/event-reducer.js';
import { loadLimitLookup } from './data/models.js';
import { renderLines } from './render/renderer.js';
import { buildRenderContext } from './render/context.js';
import { repaint } from './render/ansi.js';
import { loadSettings } from './utils/config.js';
import { emptyState, type OpencodeState } from './types/index.js';
import { fetchOpenRouterBalanceWithSource, fetchOpenRouterUsage } from './tui/openrouter.js';
import { updateWeeklyState } from './data/openrouter-weekly.js';
import type { OpenRouterWeeklyContext } from './types/index.js';
import { readProjectStatus, type ProjectStatus } from './data/project-status.js';
import { derive } from './data/selectors.js';
import { resolve } from 'node:path';

let prevLineCount = 0;

export function createDaemonProjectStatusCache(read: (cwd: string | null) => Promise<ProjectStatus> = readProjectStatus) {
  let currentKey: string | null = null;
  let currentStatus: ProjectStatus = { productionVersion: null, root: null };
  const pendingReads = new Map<string, Promise<void>>();

  const get = (cwd: string | null): ProjectStatus => !cwd || resolve(cwd) !== currentKey ? { productionVersion: null, root: null } : currentStatus;
  const refresh = (cwd: string | null): Promise<void> => {
    const nextKey = cwd ? resolve(cwd) : null;
    if (nextKey !== currentKey) {
      currentKey = nextKey;
      currentStatus = { productionVersion: null, root: null };
    }
    if (!cwd || !nextKey) return Promise.resolve();
    const pending = pendingReads.get(nextKey);
    if (pending) return pending;
    const requestedKey = nextKey;
    const readPromise = read(cwd).then((status) => {
      if (currentKey === requestedKey) currentStatus = status;
    });
    const trackedRead = readPromise.finally(() => {
      if (pendingReads.get(requestedKey) === trackedRead) pendingReads.delete(requestedKey);
    });
    pendingReads.set(requestedKey, trackedRead);
    return trackedRead;
  };
  return { get, refresh };
}

function paint(state: OpencodeState, settings: ReturnType<typeof loadSettings>, getLimit: ReturnType<typeof loadLimitLookup>, openrouterWeekly: OpenRouterWeeklyContext, productionVersion: string | null) {
  const ctx = buildRenderContext(state, getLimit, { openrouterWeekly, productionVersion });
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
  const projectStatus = createDaemonProjectStatusCache();
  const render = () => {
    const cwd = derive(state, getLimit, Date.now()).cwd;
    paint(state, settings, getLimit, openrouterWeekly, projectStatus.get(cwd).productionVersion);
  };
  const refreshProjectStatusAndRender = () => {
    const cwd = derive(state, getLimit, Date.now()).cwd;
    const pending = projectStatus.refresh(cwd);
    render();
    void pending.then(() => {
      if (derive(state, getLimit, Date.now()).cwd === cwd) render();
    });
  };
  const refreshBalance = async () => {
    const [balance, usage] = await Promise.all([fetchOpenRouterBalanceWithSource(), fetchOpenRouterUsage()]);
    openrouterWeekly = updateWeeklyState(balance, usage, settings.openrouter.weeklyBudgetUsd, Date.now(), openrouterWeekly);
    render();
  };

  const conn = await connect(serverUrl);
  if (!serverUrl) {
    process.stderr.write(`ocstatusline: managed server at ${conn.serverUrl}\n`);
    process.stderr.write(`  attach your session with: opencode attach ${conn.serverUrl}\n`);
  }
  state = { ...state, connected: true };

  const stop = await subscribeEvents(conn.client, (ev) => {
    state = reduce(state, ev);
    refreshProjectStatusAndRender();
  });

  const tick = setInterval(render, settings.refreshInterval);
  const projectStatusTick = setInterval(refreshProjectStatusAndRender, 2_000);
  const balanceTick = setInterval(refreshBalance, 60_000);
  void refreshBalance();
  refreshProjectStatusAndRender();

  const shutdown = () => { clearInterval(tick); clearInterval(projectStatusTick); clearInterval(balanceTick); stop(); conn.close(); process.stdout.write('\n'); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (timeoutMs && timeoutMs > 0) {
    setTimeout(shutdown, timeoutMs);
  }
}
