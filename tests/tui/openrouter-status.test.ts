import { describe, expect, it, vi } from 'vitest';
import { createServer, type Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchOpenRouterStatus, runOpenRouterStatus } from '../../src/tui/openrouter-status.js';

// Same real Unix-socket secretd test double tests/tui/openrouter.test.ts
// uses -- fetchOpenRouterStatus is a thin Promise.all wrapper around the
// same socket functions, so it needs the same fixture, not a mock of them.
function startSecretdTestServer(onConnection: (socket: Socket) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'ocsl-secretd-status-'));
  const socketPath = join(dir, 'sock');
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    onConnection(socket);
  });
  const ready = new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve());
  });
  const close = async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  };
  return { ready, path: socketPath, close };
}

async function withSecretdServer<T>(onConnection: (socket: Socket) => void, run: (socketPath: string) => Promise<T>): Promise<T> {
  const { ready, path, close } = startSecretdTestServer(onConnection);
  await ready;
  try {
    return await run(path);
  } finally {
    await close();
  }
}

function respondByModule(socket: Socket, responses: Record<string, unknown>) {
  socket.on('data', (data) => {
    const request = JSON.parse(data.toString('utf8')) as { module: string };
    socket.write(`${JSON.stringify(responses[request.module])}\n`);
  });
}

describe('fetchOpenRouterStatus', () => {
  it('combines balance (with source) and usage from a single fetch', async () => {
    await withSecretdServer(
      (socket) => respondByModule(socket, { 'openrouter/credits': { ok: true, result: 47.78 }, 'openrouter/usage': { ok: true, result: 12.5 } }),
      async (socketPath) => {
        await expect(fetchOpenRouterStatus(1000, undefined, socketPath)).resolves.toEqual({ balance: { source: 'account', balanceUsd: 47.78 }, usage: 12.5 });
      },
    );
  });

  it('falls back to key-limit and still reports usage', async () => {
    await withSecretdServer(
      (socket) => respondByModule(socket, { 'openrouter/credits': { ok: true, result: null }, 'openrouter/key-limit': { ok: true, result: 8.5 }, 'openrouter/usage': { ok: true, result: 3 } }),
      async (socketPath) => {
        await expect(fetchOpenRouterStatus(1000, undefined, socketPath)).resolves.toEqual({ balance: { source: 'key-limit', balanceUsd: 8.5 }, usage: 3 });
      },
    );
  });

  it('resolves to nulls without throwing when secretd is unreachable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ocsl-secretd-status-missing-'));
    const missingSocketPath = join(dir, 'sock');
    try {
      await expect(fetchOpenRouterStatus(1000, undefined, missingSocketPath)).resolves.toEqual({ balance: null, usage: null });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('runOpenRouterStatus', () => {
  it('writes exactly one JSON line to stdout', async () => {
    const written: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
    try {
      await runOpenRouterStatus({ timeoutMs: 50 });
    } finally {
      spy.mockRestore();
    }
    expect(written).toHaveLength(1);
    expect(written[0]!.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(written[0]!);
    expect(parsed).toHaveProperty('balance');
    expect(parsed).toHaveProperty('usage');
  });
});
