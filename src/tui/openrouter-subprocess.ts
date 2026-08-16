import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { OpenRouterBalance } from '../types/index.js';

export type { OpenRouterBalance };

const execFileAsync = promisify(execFile);

// Why this file exists, and why it does NOT talk to secretd's socket
// directly (contrast with openrouter.ts): secretd authenticates a caller by
// checking the code signature of whatever OS process actually holds the
// socket connection. When this code runs as part of the OpenCode TUI plugin
// (.opencode/tui-plugins/ocstatusline.ts, installed into every project via
// `ocstatusline install`), the connecting process is `opencode` itself --
// its signature can never match the requirement secretd has registered for
// `signed_clients.ocstatusline` (scoped to the real compiled
// `ocstatusline-darwin-arm64` binary), no matter how the plugin registers.
// The fix is to never connect from inside the plugin at all: shell out to
// the real, separately-signed `ocstatusline` binary and let *it* talk to
// secretd (see src/tui/openrouter-status.ts, the `openrouter-status`
// subcommand this calls), the same way `secretctl` lets other unsigned
// callers reach secretd through a signed intermediary.
//
// The standalone daemon (src/daemon.ts, `ocstatusline start`) and the CLI
// subcommand itself keep calling openrouter.ts's socket functions directly
// -- when *this* code runs as that process, it already is the signed
// binary, so there is nothing to delegate.
const DEFAULT_TIMEOUT_MS = 5_000; // headroom over openrouter.ts's own 3s per-call secretd timeout, to also cover process startup
const BINARY_NAME = 'ocstatusline';
// Tried, in order, after a bare PATH lookup fails with ENOENT: the plugin
// runs inside whatever environment launched `opencode`, which is not
// guaranteed to have Homebrew's bin dir on PATH (e.g. a GUI launcher with a
// minimal PATH) even though a normal terminal session would.
const FALLBACK_BINARY_PATHS = ['/opt/homebrew/bin/ocstatusline', '/usr/local/bin/ocstatusline'];

export interface OpenRouterStatus {
  balance: OpenRouterBalance | null;
  usage: number | null;
}

const EMPTY_STATUS: OpenRouterStatus = { balance: null, usage: null };

function isValidBalance(value: unknown): value is OpenRouterBalance {
  if (!value || typeof value !== 'object') return false;
  const balance = value as { source?: unknown; balanceUsd?: unknown };
  return (balance.source === 'account' || balance.source === 'key-limit') && typeof balance.balanceUsd === 'number' && Number.isFinite(balance.balanceUsd);
}

// Parses `ocstatusline openrouter-status`'s stdout. Anything that isn't the
// well-formed { balance, usage } shape is treated as a protocol failure and
// answered with the same empty status a connection failure produces -- fail
// closed, mirroring openrouter.ts's own parseSecretdResponse.
export function parseOpenRouterStatus(stdout: string): OpenRouterStatus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    return EMPTY_STATUS;
  }
  if (!parsed || typeof parsed !== 'object') return EMPTY_STATUS;
  const record = parsed as { balance?: unknown; usage?: unknown };
  const balance = isValidBalance(record.balance) ? record.balance : null;
  const usage = typeof record.usage === 'number' && Number.isFinite(record.usage) ? record.usage : null;
  return { balance, usage };
}

// Fetches the OpenRouter balance and usage by shelling out to the real
// signed `ocstatusline` binary instead of connecting to secretd directly.
// Never throws: a missing binary, a non-zero exit, a timeout, or a
// malformed response all fail closed to { balance: null, usage: null } --
// exactly what the direct-socket version in openrouter.ts does when secretd
// itself is unreachable, so callers (the TUI plugin) see the same
// degradation either way.
export async function fetchOpenRouterStatusViaBinary(timeoutMs: number = DEFAULT_TIMEOUT_MS, signal?: AbortSignal, binaryCandidates: string[] = [BINARY_NAME, ...FALLBACK_BINARY_PATHS]): Promise<OpenRouterStatus> {
  if (signal?.aborted) return EMPTY_STATUS;
  for (const candidate of binaryCandidates) {
    try {
      const { stdout } = await execFileAsync(candidate, ['openrouter-status'], { timeout: timeoutMs, signal, encoding: 'utf8' });
      return parseOpenRouterStatus(stdout);
    } catch (err) {
      if (signal?.aborted) return EMPTY_STATUS;
      // ENOENT (this candidate does not exist) is the only reason to try the
      // next candidate -- any other failure (non-zero exit, timeout, killed)
      // means the binary was found and the call itself failed, so fail
      // closed instead of masking it behind a retry on a different path.
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') return EMPTY_STATUS;
    }
  }
  return EMPTY_STATUS;
}
