import { describe, expect, it } from 'vitest';
import { createDaemonProjectStatusCache } from '../src/daemon.js';

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
});
