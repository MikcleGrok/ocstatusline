import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MAX_STATUS_CACHE_ENTRIES, readProjectStatus, readProjectStatusCachedSync, readProjectStatusSync } from '../../src/data/project-status.js';

let roots: string[] = [];
afterEach(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); roots = []; });

function fixture(content: string, nested = true): string {
  const root = mkdtempSync(join(tmpdir(), 'ocsl-status-'));
  roots.push(root);
  mkdirSync(join(root, '.status'), { recursive: true });
  writeFileSync(join(root, '.status/state.json'), content);
  const cwd = nested ? join(root, 'packages/app') : root;
  mkdirSync(cwd, { recursive: true });
  return cwd;
}

describe('project status reader', () => {
  it('finds production.version from a parent project root', async () => {
    const cwd = fixture('{"production":{"version":"2026.08.04"}}');
    expect(readProjectStatusSync(cwd)).toEqual({ productionVersion: '2026.08.04', root: cwd.split('/packages/app')[0] });
    expect(await readProjectStatus(cwd)).toEqual({ productionVersion: '2026.08.04', root: cwd.split('/packages/app')[0] });
  });
  it('fails closed for missing, malformed, and invalid version values', () => {
    expect(readProjectStatusSync('/tmp/ocsl-definitely-missing')).toEqual({ productionVersion: null, root: null });
    for (const content of ['{', '[]', '{"production":[]}', '{"production":{"version":42}}', '{"production":{"version":"1.2.3\\u001b[31m"}}', '{"production":{"version":"1.2.3\\nfooter"}}']) {
      const cwd = fixture(content, false);
      expect(readProjectStatusSync(cwd).productionVersion).toBeNull();
    }
  });

  it('keeps render-context reads cached while async refresh observes file changes', async () => {
    const cwd = fixture('{"production":{"version":"1.0.0"}}', false);
    expect(readProjectStatusCachedSync(cwd).productionVersion).toBe('1.0.0');
    writeFileSync(join(cwd, '.status/state.json'), '{"production":{"version":"2.0.0"}}');
    expect(readProjectStatusCachedSync(cwd).productionVersion).toBe('1.0.0');
    await expect(readProjectStatus(cwd)).resolves.toMatchObject({ productionVersion: '2.0.0' });
    expect(readProjectStatusCachedSync(cwd).productionVersion).toBe('2.0.0');
  });

  it('evicts the oldest cached missing-status cwd', async () => {
    const cwds: string[] = [];
    for (let i = 0; i <= MAX_STATUS_CACHE_ENTRIES; i++) {
      const root = mkdtempSync(join(tmpdir(), 'ocsl-missing-'));
      roots.push(root);
      const cwd = join(root, 'packages/app');
      mkdirSync(cwd, { recursive: true });
      cwds.push(cwd);
      await expect(readProjectStatus(cwd)).resolves.toEqual({ productionVersion: null, root: null });
    }
    mkdirSync(join(cwds[0], '.status'), { recursive: true });
    writeFileSync(join(cwds[0], '.status/state.json'), '{"production":{"version":"evicted"}}');
    expect(readProjectStatusCachedSync(cwds[0]).productionVersion).toBe('evicted');
  });

});
