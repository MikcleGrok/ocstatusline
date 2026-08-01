import { connect, subscribeEvents } from './data/server.js';
import { reduce } from './data/event-reducer.js';
import { loadLimitLookup } from './data/models.js';
import { renderLines } from './render/renderer.js';
import { buildRenderContext } from './render/context.js';
import { repaint } from './render/ansi.js';
import { loadSettings } from './utils/config.js';
import { emptyState, type OpencodeState } from './types/index.js';

let prevLineCount = 0;

function paint(state: OpencodeState, settings: ReturnType<typeof loadSettings>, getLimit: ReturnType<typeof loadLimitLookup>) {
  const ctx = buildRenderContext(state, getLimit);
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

  const conn = await connect(serverUrl);
  if (!serverUrl) {
    process.stderr.write(`ocstatusline: managed server at ${conn.serverUrl}\n`);
    process.stderr.write(`  attach your session with: opencode attach ${conn.serverUrl}\n`);
  }
  state = { ...state, connected: true };

  const stop = await subscribeEvents(conn.client, (ev) => {
    state = reduce(state, ev);
    paint(state, settings, getLimit);
  });

  const tick = setInterval(() => paint(state, settings, getLimit), settings.refreshInterval);
  paint(state, settings, getLimit);

  const shutdown = () => { clearInterval(tick); stop(); conn.close(); process.stdout.write('\n'); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (timeoutMs && timeoutMs > 0) {
    setTimeout(shutdown, timeoutMs);
  }
}
