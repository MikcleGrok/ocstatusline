import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { OpenRouterBalance } from '../types/index.js';

export type { OpenRouterBalance };

const execFileAsync = promisify(execFile);
const EMPTY_STATUS: OpenRouterStatus = { balance: null, usage: null };
const FALLBACK_BINARY_PATHS = ['/opt/homebrew/bin/ocstatusline', '/usr/local/bin/ocstatusline'];

export interface OpenRouterStatus {
  balance: OpenRouterBalance | null;
  usage: number | null;
}

function validBalance(value: unknown): value is OpenRouterBalance {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { source?: unknown; balanceUsd?: unknown };
  return (candidate.source === 'account' || candidate.source === 'key-limit') && typeof candidate.balanceUsd === 'number' && Number.isFinite(candidate.balanceUsd);
}

export function parseOpenRouterStatus(stdout: string): OpenRouterStatus {
  try {
    const parsed: unknown = JSON.parse(stdout.trim());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY_STATUS;
    const record = parsed as { balance?: unknown; usage?: unknown };
    return { balance: validBalance(record.balance) ? record.balance : null, usage: typeof record.usage === 'number' && Number.isFinite(record.usage) ? record.usage : null };
  } catch {
    return EMPTY_STATUS;
  }
}

export async function fetchOpenRouterStatusViaBinary(timeoutMs = 5000, signal?: AbortSignal, binaryCandidates = ['ocstatusline', ...FALLBACK_BINARY_PATHS]): Promise<OpenRouterStatus> {
  if (signal?.aborted) return EMPTY_STATUS;
  for (const candidate of binaryCandidates) {
    try {
      const { stdout } = await execFileAsync(candidate, ['openrouter-status'], { timeout: timeoutMs, signal, encoding: 'utf8' });
      return parseOpenRouterStatus(stdout);
    } catch (error) {
      if (signal?.aborted || (error as NodeJS.ErrnoException).code !== 'ENOENT') return EMPTY_STATUS;
    }
  }
  return EMPTY_STATUS;
}
