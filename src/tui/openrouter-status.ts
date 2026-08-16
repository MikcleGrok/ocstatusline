import { fetchOpenRouterBalanceWithSource, fetchOpenRouterUsage, type OpenRouterBalance } from './openrouter.js';

// The `ocstatusline openrouter-status` CLI subcommand: a one-shot fetch of
// both the OpenRouter balance and usage over the local secretd socket,
// printed as a single JSON line on stdout. This is the whole point of the
// subcommand -- it lets a process that cannot itself carry a trustworthy
// codesign identity (the TUI plugin, embedded inside the `opencode` host
// process) delegate the actual secretd call to this real, signed binary via
// subprocess instead of connecting to the socket itself. See
// src/tui/openrouter-subprocess.ts for the subprocess-calling side of this.

export interface OpenRouterStatus {
  balance: OpenRouterBalance | null;
  usage: number | null;
}

// Both calls already fail closed to null on any error (daemon not running,
// timeout, malformed response) -- see openrouter.ts -- so this never throws.
// socketPath is threaded through (default: the real secretd socket) purely
// so tests can point this at a fixture server, matching every socket
// function it composes.
export async function fetchOpenRouterStatus(timeoutMs?: number, signal?: AbortSignal, socketPath?: string): Promise<OpenRouterStatus> {
  const [balance, usage] = await Promise.all([fetchOpenRouterBalanceWithSource(timeoutMs, signal, socketPath), fetchOpenRouterUsage(timeoutMs, signal, socketPath)]);
  return { balance, usage };
}

export async function runOpenRouterStatus(opts: { timeoutMs?: number } = {}): Promise<void> {
  const status = await fetchOpenRouterStatus(opts.timeoutMs);
  process.stdout.write(`${JSON.stringify(status)}\n`);
}
