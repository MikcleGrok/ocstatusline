import { connect, subscribeEvents } from './data/server.js';
import { reduce } from './data/event-reducer.js';
import { derive } from './data/selectors.js';
import { loadLimitLookup } from './data/models.js';
import { getGitInfo } from './data/git.js';
import { renderLines } from './render/renderer.js';
import { repaint } from './render/ansi.js';
import { loadSettings } from './utils/config.js';
import { emptyState, type OpencodeState, type RenderContext } from './types/index.js';

let prevLineCount = 0;

function paint(state: OpencodeState, settings: ReturnType<typeof loadSettings>, getLimit: ReturnType<typeof loadLimitLookup>) {
  const now = Date.now();
  const derived = derive(state, getLimit, now);
  const git = getGitInfo(derived.cwd);
  const termWidth = process.stdout.columns || 120;
  const ctx: RenderContext = { state, derived, git, termWidth, now };
  const lines = renderLines(ctx, settings);
  process.stdout.write(repaint(lines, prevLineCount));
  prevLineCount = lines.length;
}

export async function runDaemon(opts: { serverUrl?: string }): Promise<void> {
  const settings = loadSettings();
  const getLimit = loadLimitLookup();
  const serverUrl = opts.serverUrl;
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
}
