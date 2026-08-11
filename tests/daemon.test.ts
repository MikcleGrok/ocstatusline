import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDaemonProjectStatusCache, registerDaemonShutdown } from '../src/daemon.js';
import { subscribeEvents } from '../src/data/server.js';

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
