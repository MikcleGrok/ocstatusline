import { describe, expect, it, vi } from 'vitest';
import { createServer, type Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchOpenRouterStatus, runOpenRouterStatus } from '../../src/tui/openrouter-status.js';

function serverFor(responses: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'ocsl-status-'));
  const path = join(dir, 'sock');
  const server = createServer((socket: Socket) => socket.once('data', (data) => {
    const module = (JSON.parse(data.toString()) as { module: string }).module;
    socket.end(`${JSON.stringify(responses[module])}\n`);
  }));
  const ready = new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
  return { path, ready, close: () => new Promise<void>((resolve) => server.close(() => { rmSync(dir, { recursive: true, force: true }); resolve(); })) };
}

describe('openrouter-status', () => {
  it('combines balance and usage through configured socket', async () => {
    const fixture = serverFor({ 'openrouter/credits': { ok: true, result: 47.78 }, 'openrouter/usage': { ok: true, result: 12.5 } });
    await fixture.ready;
    try { await expect(fetchOpenRouterStatus(1000, undefined, fixture.path)).resolves.toEqual({ balance: { source: 'account', balanceUsd: 47.78 }, usage: 12.5 }); } finally { await fixture.close(); }
  });

  it('writes one JSON line to stdout and nothing to stderr on missing socket', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await runOpenRouterStatus({ timeoutMs: 20 });
    expect(stdout).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(stdout.mock.calls[0]?.[0]))).toEqual({ balance: null, usage: null });
    expect(stderr).not.toHaveBeenCalled();
    stdout.mockRestore();
    stderr.mockRestore();
  });
});
