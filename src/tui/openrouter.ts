import { homedir } from 'node:os';
import { join } from 'node:path';
import { createConnection } from 'node:net';

// One connection, one request, one response: the secretd consumer<->core wire
// protocol (see secretd's internal/protocol/protocol.go). Each line is a
// single JSON object terminated by '\n'.
const DEFAULT_TIMEOUT_MS = 3000;
const CREDITS_MODULE = 'openrouter/credits';
const KEY_LIMIT_MODULE = 'openrouter/key-limit';

export function secretdSocketPath(): string {
  return join(homedir(), '.secretd', 'sock');
}

interface SecretdCallResult {
  ok: boolean;
  result: unknown;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// Parses one secretd response line. Returns null on anything that isn't a
// well-formed { ok: boolean, ... } object, which the caller treats as a
// protocol failure (fail closed, no fallback attempt).
function parseSecretdResponse(line: string): SecretdCallResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || typeof (parsed as { ok?: unknown }).ok !== 'boolean') return null;
  const response = parsed as { ok: boolean; result?: unknown };
  return { ok: response.ok, result: response.result ?? null };
}

function callSecretdModule(socketPath: string, module: string, timeoutMs: number, externalSignal?: AbortSignal): Promise<SecretdCallResult | null> {
  return new Promise((resolve) => {
    if (externalSignal?.aborted) {
      resolve(null);
      return;
    }
    let settled = false;
    let buffer = '';
    const socket = createConnection({ path: socketPath });
    const finish = (value: SecretdCallResult | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onAbort);
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const onAbort = () => finish(null);
    externalSignal?.addEventListener('abort', onAbort, { once: true });
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ op: 'call', module })}\n`);
    });
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex === -1) return;
      finish(parseSecretdResponse(buffer.slice(0, newlineIndex)));
    });
    // A connection failure (daemon not running/installed, socket missing) and
    // an unexpected close both fail closed the same way as a malformed
    // response or a timeout -- never throw out of this function.
    socket.on('error', () => finish(null));
    socket.on('close', () => finish(null));
  });
}

// Reads the OpenRouter balance from the local secretd daemon over its Unix
// socket. Tries the management-key credits module first; if secretd has no
// data registered for it (ok: true, result: null), falls back to the
// OpenCode-issued key's remaining limit. Any connection failure, protocol
// error, or timeout fails closed and resolves to null -- this never throws
// and never logs, since "secretd isn't installed/running yet" is the common
// case today, not an error worth surfacing.
export async function fetchOpenRouterBalance(timeoutMs: number = DEFAULT_TIMEOUT_MS, signal?: AbortSignal, socketPath: string = secretdSocketPath()): Promise<number | null> {
  if (signal?.aborted) return null;
  const primary = await callSecretdModule(socketPath, CREDITS_MODULE, timeoutMs, signal);
  if (!primary || !primary.ok) return null;
  if (primary.result === null) {
    const secondary = await callSecretdModule(socketPath, KEY_LIMIT_MODULE, timeoutMs, signal);
    if (!secondary || !secondary.ok) return null;
    return finiteNumber(secondary.result);
  }
  return finiteNumber(primary.result);
}
