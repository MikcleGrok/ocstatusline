import { describe, expect, it, vi } from 'vitest';
import { createServer, type Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fetchOpenRouterBalance, secretdSocketPath } from '../../src/tui/openrouter.js';

// Real Unix domain socket test double for the secretd consumer<->core wire
// protocol: one connection, one request line of JSON, one response line of
// JSON. Each call opens its own connection, so `onConnection` fires once per
// module call `fetchOpenRouterBalance` makes.
function startSecretdTestServer(onConnection: (socket: Socket) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'ocsl-secretd-'));
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

function respondOnce(socket: Socket, response: unknown, onRequest?: (line: string) => void) {
  socket.once('data', (data) => {
    onRequest?.(data.toString('utf8'));
    socket.end(`${JSON.stringify(response)}\n`);
  });
}

describe('secretd socket path', () => {
  it('resolves under the home directory', () => {
    expect(secretdSocketPath()).toBe(join(homedir(), '.secretd', 'sock'));
  });
});

describe('fetchOpenRouterBalance over the secretd socket', () => {
  it('sends the exact call request and returns the credits balance', async () => {
    const received: string[] = [];
    await withSecretdServer(
      (socket) => respondOnce(socket, { ok: true, result: 47.78 }, (line) => received.push(line)),
      async (socketPath) => {
        await expect(fetchOpenRouterBalance(1000, undefined, socketPath)).resolves.toBe(47.78);
      },
    );
    expect(received).toEqual(['{"op":"call","module":"openrouter/credits"}\n']);
  });

  it('falls back to openrouter/key-limit when credits has no data', async () => {
    const modules: unknown[] = [];
    await withSecretdServer(
      (socket) => {
        socket.once('data', (data) => {
          const request = JSON.parse(data.toString('utf8')) as { module?: string };
          modules.push(request.module);
          const response = request.module === 'openrouter/credits' ? { ok: true, result: null } : { ok: true, result: 12.34 };
          socket.end(`${JSON.stringify(response)}\n`);
        });
      },
      async (socketPath) => {
        await expect(fetchOpenRouterBalance(1000, undefined, socketPath)).resolves.toBe(12.34);
      },
    );
    expect(modules).toEqual(['openrouter/credits', 'openrouter/key-limit']);
  });

  it('returns null when both credits and key-limit have no data', async () => {
    await withSecretdServer(
      (socket) => respondOnce(socket, { ok: true, result: null }),
      async (socketPath) => {
        await expect(fetchOpenRouterBalance(1000, undefined, socketPath)).resolves.toBeNull();
      },
    );
  });

  it('does not attempt key-limit once credits already has a numeric balance', async () => {
    let connections = 0;
    await withSecretdServer(
      (socket) => {
        connections += 1;
        respondOnce(socket, { ok: true, result: 47.78 });
      },
      async (socketPath) => {
        await expect(fetchOpenRouterBalance(1000, undefined, socketPath)).resolves.toBe(47.78);
      },
    );
    expect(connections).toBe(1);
  });

  it('returns null without throwing when the socket does not exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ocsl-secretd-'));
    const missingSocketPath = join(dir, 'sock');
    try {
      await expect(fetchOpenRouterBalance(1000, undefined, missingSocketPath)).resolves.toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when the daemon reports a failure', async () => {
    await withSecretdServer(
      (socket) => respondOnce(socket, { ok: false, code: 'forbidden', error: 'openrouter/credits: identity unsigned not allowed' }),
      async (socketPath) => {
        await expect(fetchOpenRouterBalance(1000, undefined, socketPath)).resolves.toBeNull();
      },
    );
  });

  it('returns null for a non-JSON response line', async () => {
    await withSecretdServer(
      (socket) => socket.once('data', () => socket.end('not-json\n')),
      async (socketPath) => {
        await expect(fetchOpenRouterBalance(1000, undefined, socketPath)).resolves.toBeNull();
      },
    );
  });

  it('returns null for a well-formed but unexpected response shape', async () => {
    await withSecretdServer(
      (socket) => respondOnce(socket, { unexpected: true }),
      async (socketPath) => {
        await expect(fetchOpenRouterBalance(1000, undefined, socketPath)).resolves.toBeNull();
      },
    );
  });

  it('times out and returns null when the daemon never responds', async () => {
    await withSecretdServer(
      () => {
        // Deliberately never write a response; the client's own timeout must fire.
      },
      async (socketPath) => {
        await expect(fetchOpenRouterBalance(50, undefined, socketPath)).resolves.toBeNull();
      },
    );
  });

  it('returns null when the external signal aborts before the daemon responds', async () => {
    await withSecretdServer(
      () => {
        // Deliberately never write a response; the abort must win the race.
      },
      async (socketPath) => {
        const controller = new AbortController();
        const request = fetchOpenRouterBalance(1000, controller.signal, socketPath);
        controller.abort();
        await expect(request).resolves.toBeNull();
      },
    );
  });

  it('returns null immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(fetchOpenRouterBalance(1000, controller.signal, '/nonexistent/should-not-be-dialed.sock')).resolves.toBeNull();
  });

  it('does not log anything on the common daemon-not-running path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ocsl-secretd-'));
    const missingSocketPath = join(dir, 'sock');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await expect(fetchOpenRouterBalance(1000, undefined, missingSocketPath)).resolves.toBeNull();
      expect(consoleError).not.toHaveBeenCalled();
      expect(consoleWarn).not.toHaveBeenCalled();
      expect(consoleLog).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
      consoleWarn.mockRestore();
      consoleLog.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
