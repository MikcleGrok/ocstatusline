import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDaemonProjectStatusCache, registerDaemonShutdown } from '../src/daemon.js';
import { subscribeEvents } from '../src/data/server.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('daemon project status cache', () => {
  it('starts the new cwd while the old read is pending and ignores the old result', async () => {
    const reads: string[] = [];
    const resolvers = new Map<string, (status: { productionVersion: string | null; root: string | null }) => void>();
    const cache = createDaemonProjectStatusCache((cwd) => {
      reads.push(cwd ?? '');
      return new Promise((resolve) => { resolvers.set(cwd ?? '', resolve); });
    });

    const first = cache.refresh('/project-a');
    const duplicate = cache.refresh('/project-a');
    expect(cache.get('/project-a').productionVersion).toBeNull();
    expect(reads).toEqual(['/project-a']);

    const second = cache.refresh('/project-b');
    expect(cache.get('/project-b').productionVersion).toBeNull();
    expect(reads).toEqual(['/project-a', '/project-b']);
    resolvers.get('/project-a')?.({ productionVersion: '1.0.0', root: '/project-a' });
    await first;
    expect(cache.get('/project-b').productionVersion).toBeNull();
    resolvers.get('/project-b')?.({ productionVersion: '2.0.0', root: '/project-b' });
    await Promise.all([duplicate, second]);
    expect(cache.get('/project-a').productionVersion).toBeNull();
    await second;
    expect(cache.get('/project-b').productionVersion).toBe('2.0.0');
  });

  it('keeps only the current cwd read pending when old reads never settle', () => {
    const cache = createDaemonProjectStatusCache(() => new Promise(() => {}));

    for (let i = 0; i < 100; i++) cache.refresh(`/project-${i}`);

    expect(cache.pendingCount()).toBe(1);
  });

  it('shuts down once when SIGINT and SIGTERM are both delivered', () => {
    vi.useFakeTimers();
    const stop = vi.fn();
    const close = vi.fn();
    const timers = [setInterval(() => {}, 60_000), setInterval(() => {}, 60_000), setInterval(() => {}, 60_000)];
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const sigintBefore = process.listeners('SIGINT');
    const sigtermBefore = process.listeners('SIGTERM');

    registerDaemonShutdown({ timers, stop, close, timeoutMs: 60_000 });
    expect(process.listenerCount('SIGINT')).toBe(sigintBefore.length + 1);
    expect(process.listenerCount('SIGTERM')).toBe(sigtermBefore.length + 1);

    process.emit('SIGINT');
    process.emit('SIGTERM');

    expect(stop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(timers.length);
    expect(clearTimeoutSpy).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
    expect(process.listeners('SIGINT')).toEqual(sigintBefore);
    expect(process.listeners('SIGTERM')).toEqual(sigtermBefore);
  });

  it('does not accumulate timers or signal listeners across repeated shutdowns', () => {
    vi.useFakeTimers();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const sigintBefore = process.listeners('SIGINT');
    const sigtermBefore = process.listeners('SIGTERM');

    for (let i = 0; i < 50; i++) {
      const timers = [setInterval(() => {}, 60_000), setInterval(() => {}, 60_000)];
      registerDaemonShutdown({ timers, stop: vi.fn(), close: vi.fn(), timeoutMs: 60_000 });
      process.emit('SIGTERM');
      expect(process.listeners('SIGINT')).toEqual(sigintBefore);
      expect(process.listeners('SIGTERM')).toEqual(sigtermBefore);
      expect(vi.getTimerCount()).toBe(0);
    }

    expect(exit).toHaveBeenCalledTimes(50);
  });
});

describe('daemon event subscription', () => {
  it('closes the async iterator exactly once when stopped repeatedly', async () => {
    const returnSpy = vi.fn(async () => ({ done: true, value: undefined }));
    const client = { event: { subscribe: vi.fn(async () => ({ stream: { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}), return: returnSpy }) } })) } };

    const stop = await subscribeEvents(client as never, vi.fn());
    stop();
    stop();
    await Promise.resolve();

    expect(returnSpy).toHaveBeenCalledOnce();
  });
});

describe('daemon process lifecycle', () => {
  let mock: ChildProcess | null = null;

  afterEach(async () => {
    if (mock) await stopProcess(mock);
    mock = null;
  });

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    it(`exits cleanly after ${signal}`, async () => {
      mock = spawn('bun', ['tests/mock/mock-opencode.ts'], {
        cwd: process.cwd(),
        env: { ...process.env, MOCK_PORT: '0', MOCK_DELAY_MS: '25', MOCK_LOOP: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const mockOutput = captureOutput(mock);
      const mockReady = await waitForOutput(mock, mockOutput.stdout, mockOutput.stderr, /mock-opencode listening on port (\d+)/, 3_000);
      const home = await mkdtemp(join(tmpdir(), 'ocstatusline-daemon-'));
      await mkdir(join(home, '.config', 'ocstatusline'), { recursive: true });
      const port = mockReady[1];
      let child: ChildProcess | null = null;
      try {
        child = spawn('bun', ['src/index.ts', 'start', '--server', `http://127.0.0.1:${port}`], {
          cwd: process.cwd(),
          env: { ...process.env, HOME: home, XDG_CONFIG_HOME: `${home}/.config`, COLUMNS: '120' },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const output = captureOutput(child);
        await waitForHttp(`http://127.0.0.1:${port}/healthz`, 3_000);
        await waitForOutput(child, output.stdout, output.stderr, /\x1b\[0J/, 3_000);
        await delay(100);
        child.kill(signal);
        const [exitCode, exitSignal] = await waitForExit(child, 3_000);
        expect({ exitCode, exitSignal }, `stdout=${output.stdout.join('')}\nstderr=${output.stderr.join('')}`).toEqual({ exitCode: 0, exitSignal: null });
        expect(child.exitCode).toBe(0);
      } finally {
        if (child) await stopProcess(child);
        await stopProcess(mock);
        await rm(home, { recursive: true, force: true });
      }
    }, 10_000);
  }
});

function captureOutput(child: ChildProcess): { stdout: string[]; stderr: string[] } {
  const output = { stdout: [] as string[], stderr: [] as string[] };
  child.stdout?.on('data', (chunk: Buffer) => output.stdout.push(chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => output.stderr.push(chunk.toString()));
  return output;
}

async function waitForOutput(child: ChildProcess, chunks: string[], errors: string[], pattern: RegExp, timeoutMs: number): Promise<RegExpMatchArray> {
  const existing = chunks.join('').match(pattern);
  if (existing) return existing;
  return new Promise<RegExpMatchArray>((resolve, reject) => {
    const onData = () => {
      const match = chunks.join('').match(pattern);
      if (match) finish(() => resolve(match));
    };
    const onExit = () => finish(() => reject(new Error(`process exited before output ${pattern}: stdout=${chunks.join('')} stderr=${errors.join('')}`)));
    const timer = setTimeout(() => finish(() => reject(new Error(`timed out after ${timeoutMs}ms waiting for output ${pattern}: stdout=${chunks.join('')} stderr=${errors.join('')}`))), timeoutMs);
    const finish = (done: () => void) => {
      clearTimeout(timer);
      child.stdout?.off('data', onData);
      child.off('close', onExit);
      done();
    };
    child.stdout?.on('data', onData);
    child.once('close', onExit);
  });
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<[number | null, NodeJS.Signals | null]> {
  if (child.exitCode !== null || child.signalCode !== null) return [child.exitCode, child.signalCode];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`process did not exit within ${timeoutMs}ms`)), timeoutMs);
    once(child, 'close').then(([code, signal]) => {
      clearTimeout(timer);
      resolve([code as number | null, signal as NodeJS.Signals | null]);
    });
  });
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok && (await response.json() as { status?: string }).status === 'ok') return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${url}: ${lastError ?? 'HTTP request was not successful'}`);
}

async function delay(timeoutMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  try {
    await waitForExit(child, 1_000);
    return;
  } catch {
    child.kill('SIGKILL');
  }
  await waitForExit(child, 1_000);
}
