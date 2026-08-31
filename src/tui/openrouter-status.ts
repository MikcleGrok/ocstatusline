import { fetchOpenRouterBalanceWithSource, fetchOpenRouterUsage, type OpenRouterBalance } from './openrouter.js';

export interface OpenRouterStatus {
  balance: OpenRouterBalance | null;
  usage: number | null;
}

export async function fetchOpenRouterStatus(timeoutMs?: number, signal?: AbortSignal, socketPath?: string): Promise<OpenRouterStatus> {
  const [balance, usage] = await Promise.all([fetchOpenRouterBalanceWithSource(timeoutMs, signal, socketPath), fetchOpenRouterUsage(timeoutMs, signal, socketPath)]);
  return { balance, usage };
}

export async function runOpenRouterStatus(opts: { timeoutMs?: number } = {}): Promise<void> {
  process.stdout.write(`${JSON.stringify(await fetchOpenRouterStatus(opts.timeoutMs))}\n`);
}
