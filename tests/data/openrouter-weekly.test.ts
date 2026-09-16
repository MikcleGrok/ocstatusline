import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { accountBalanceSeverity, mergeWeeklyUsageState, mondayStartMs, updateWeeklyState, weeklyBalanceSeverity } from '../../src/data/openrouter-weekly';

const childProcesses: { child: ReturnType<typeof execFile>; done: Promise<void> }[] = [];
vi.setConfig({ testTimeout: 45_000 });
const TOKENS = {
  live: '11111111-1111-4111-8111-111111111111',
  stale: '22222222-2222-4222-8222-222222222222',
  reused: '33333333-3333-4333-8333-333333333333',
  replacement: '44444444-4444-4444-8444-444444444444',
  ambiguous: '55555555-5555-4555-8555-555555555555',
};

afterEach(async () => {
  const pending = childProcesses.splice(0);
  for (const { child } of pending) {
    try { child.kill('SIGKILL'); } catch { /* best-effort test cleanup */ }
  }
  await Promise.all(pending.map(({ done }) => withTimeout(done.catch(() => undefined), 2_000)));
});

async function withTimeout<T>(promise: Promise<T>, timeoutMs = 60_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function spawnWorker(args: string[], env: Record<string, string> = {}): { child: ReturnType<typeof execFile>; done: Promise<void> } {
  const child = execFile(runtimeForTests(), [workerPathForTests(), ...args], { env: { ...process.env, ...env } });
  let stderr = '';
  child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
  const done = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`worker exited with ${code}: ${stderr}`)));
  });
  void done.catch(() => undefined);
  childProcesses.push({ child, done });
  return { child, done };
}

async function waitForPath(path: string, deadlineMs = 5_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!existsSync(path) && Date.now() < deadline) await new Promise((resolve) => setImmediate(resolve));
  expect(existsSync(path)).toBe(true);
}

function removeTestTree(path: string): void {
  try { rmSync(path, { recursive: true, force: true }); } catch { /* best-effort test cleanup */ }
}

describe('OpenRouter weekly window', () => {
  it('returns neutral when weekly burn-rate inputs are missing or invalid', () => {
    const account = { source: 'account' as const, budgetUsd: 25, remainingUsd: 2 };
    expect(weeklyBalanceSeverity(account)).toBe('neutral');
    expect(weeklyBalanceSeverity({ ...account, spentUsd: 1, windowStartMs: 0, windowEndMs: 100 })).toBe('neutral');
    expect(weeklyBalanceSeverity({ ...account, spentUsd: 1, windowStartMs: 0, windowEndMs: 100 }, Number.NaN)).toBe('neutral');
    expect(weeklyBalanceSeverity({ ...account, spentUsd: Number.NaN, windowStartMs: 0, windowEndMs: 100 }, 50)).toBe('neutral');
    expect(weeklyBalanceSeverity({ ...account, spentUsd: 1, windowStartMs: 100, windowEndMs: 100 }, 100)).toBe('neutral');
    expect(weeklyBalanceSeverity({ ...account, source: 'key-limit', remainingUsd: 1 })).toBe('neutral');
  });

  it('classifies weekly spend by burn rate at exact ratio boundaries', () => {
    const state = { source: 'account' as const, budgetUsd: 100, spentUsd: 0, remainingUsd: 100, windowStartMs: 0, windowEndMs: 100 };
    expect(weeklyBalanceSeverity({ ...state, spentUsd: 20, remainingUsd: 80 }, 50)).toBe('sky-blue');
    expect(weeklyBalanceSeverity({ ...state, spentUsd: 33.335, remainingUsd: 66.665 }, 50)).toBe('teal');
    expect(weeklyBalanceSeverity({ ...state, spentUsd: 50, remainingUsd: 50 }, 50)).toBe('muted-green');
  });

  it('uses overshoot rather than recovering late in the window', () => {
    const state = { source: 'account' as const, budgetUsd: 25, spentUsd: 0, remainingUsd: 25, windowStartMs: 0, windowEndMs: 100 };
    expect(weeklyBalanceSeverity({ ...state, spentUsd: 64.999 / 100 * 25, remainingUsd: 8.75 }, 50)).toBe('orange');
    expect(weeklyBalanceSeverity({ ...state, spentUsd: 65 / 100 * 25, remainingUsd: 8.75 }, 50)).toBe('dark-red');
    expect(weeklyBalanceSeverity({ ...state, spentUsd: 29, remainingUsd: 0 }, 100)).toBe('over-budget');
  });

  it('classifies spend above the budget as over-budget at every window boundary', () => {
    const state = { source: 'account' as const, budgetUsd: 25, spentUsd: 25.01, remainingUsd: 0, windowStartMs: 0, windowEndMs: 100 };
    expect(weeklyBalanceSeverity(state, 0)).toBe('over-budget');
    expect(weeklyBalanceSeverity(state, 50)).toBe('over-budget');
    expect(weeklyBalanceSeverity(state, 100)).toBe('over-budget');
    expect(weeklyBalanceSeverity({ ...state, spentUsd: 25 }, 100)).toBe('muted-green');
  });

  it('handles the beginning, end, rollover, and the 16.07 dollar example', () => {
    const state = { source: 'account' as const, budgetUsd: 25, spentUsd: 0, remainingUsd: 25, windowStartMs: 0, windowEndMs: 100 };
    expect(weeklyBalanceSeverity(state, 0)).toBe('sky-blue');
    expect(weeklyBalanceSeverity({ ...state, spentUsd: 8.93, remainingUsd: 16.07 }, 10)).toBe('dark-red');
    expect(weeklyBalanceSeverity({ ...state, spentUsd: 8.93, remainingUsd: 16.07 }, 90)).toBe('sky-blue');
    expect(weeklyBalanceSeverity({ ...state, spentUsd: 8.93, remainingUsd: 16.07 }, 100)).toBe('sky-blue');
    expect(weeklyBalanceSeverity({ ...state, windowStartMs: 100, windowEndMs: 200 }, 100)).toBe('sky-blue');
    expect(weeklyBalanceSeverity({ ...state, spentUsd: 1, windowStartMs: 100, windowEndMs: 200 }, 100)).toBe('orange');
    expect(weeklyBalanceSeverity({ ...state, spentUsd: 4, windowStartMs: 100, windowEndMs: 200 }, 100)).toBe('dark-red');
  });

  it('classifies the full account balance against the weekly budget', () => {
    const account = { source: 'account' as const, budgetUsd: 25, balanceUsd: 25 };
    expect(accountBalanceSeverity(account)).toBe('sky-blue');
    expect(accountBalanceSeverity({ ...account, balanceUsd: 10 })).toBe('muted-green');
    expect(accountBalanceSeverity({ ...account, balanceUsd: 2 })).toBe('dark-red');
    expect(accountBalanceSeverity({ ...account, source: 'key-limit' })).toBe('neutral');
    expect(accountBalanceSeverity({ ...account, balanceUsd: null })).toBe('neutral');
    expect(accountBalanceSeverity({ ...account, balanceUsd: Number.NaN })).toBe('neutral');
    expect(accountBalanceSeverity({ ...account, budgetUsd: 0 })).toBe('neutral');
  });
  it('starts at local Monday midnight and ends next Monday', () => {
    const now = new Date(2026, 5, 17, 14, 30).getTime();
    const start = mondayStartMs(now);
    const path = `/tmp/ocstatusline-weekly-test-missing-${process.pid}-${Date.now()}.json`;
    try {
      const state = updateWeeklyState({ source: 'account', balanceUsd: 20 }, 25, now, null, path);
      expect(new Date(start).getDay()).toBe(1);
      expect(new Date(start).getHours()).toBe(0);
      expect(state.windowEndMs).toBeGreaterThan(start);
      expect(state.spentUsd).toBe(0);
    } finally {
      removeTestTree(path);
      removeTestTree(`${path}.records`);
      removeTestTree(`${path}.lock`);
    }
  });

  it('creates a missing state parent directory before acquiring the lock', () => {
    const now = new Date(2026, 5, 17, 14, 30).getTime();
    const root = `/tmp/ocstatusline-weekly-missing-parent-${process.pid}-${Date.now()}`;
    const path = join(root, 'nested', 'state.json');
    try {
      expect(updateWeeklyState({ source: 'account', balanceUsd: 25 }, 25, now, null, path).remainingUsd).toBe(25);
      expect(readFileSync(path, 'utf8')).toContain('accountBalanceAtStartUsd');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('creates new weekly state paths with private permissions', () => {
    const now = new Date(2026, 5, 17, 14, 30).getTime();
    const root = `/tmp/ocstatusline-weekly-private-${process.pid}-${Date.now()}`;
    const path = join(root, 'nested', 'state.json');
    try {
      updateWeeklyState({ source: 'account', balanceUsd: 25 }, 25, now, null, path);
      const recordPath = join(`${path}.records`, readdirSync(`${path}.records`).find((name) => name.endsWith('.json')) as string);
      if (process.platform !== 'win32') {
        expect(statSync(root).mode & 0o777).toBe(0o700);
        expect(statSync(join(root, 'nested')).mode & 0o777).toBe(0o700);
        expect(statSync(path).mode & 0o777).toBe(0o600);
        expect(statSync(`${path}.records`).mode & 0o777).toBe(0o700);
        expect(statSync(recordPath).mode & 0o777).toBe(0o600);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('computes spend from the account anchor and ignores key-limit updates', () => {
    const now = new Date(2026, 5, 17, 14, 30).getTime();
    const path = `/tmp/ocstatusline-weekly-${Math.random()}.json`;
    const first = updateWeeklyState({ source: 'account', balanceUsd: 25 }, 25, now, null, path);
    const second = updateWeeklyState({ source: 'account', balanceUsd: 19 }, 25, now, first, path);
    const fallback = updateWeeklyState({ source: 'key-limit', balanceUsd: 4 }, 25, now, second, path);
    expect(second.spentUsd).toBe(6);
    expect(second.remainingUsd).toBe(19);
    expect(fallback.source).toBe('account');
    expect(fallback.remainingUsd).toBe(19);
  });

  it('rejects non-finite account balances without persisting an invalid anchor', () => {
    const now = new Date(2026, 5, 17, 14, 30).getTime();
    const path = `/tmp/ocstatusline-weekly-invalid-${Math.random()}.json`;
    const nan = updateWeeklyState({ source: 'account', balanceUsd: Number.NaN }, 25, now, null, path);
    const infinity = updateWeeklyState({ source: 'account', balanceUsd: Number.POSITIVE_INFINITY }, 25, now, null, path);
    expect(nan).toMatchObject({ source: null, balanceUsd: null, remainingUsd: 25 });
    expect(infinity).toMatchObject({ source: null, balanceUsd: null, remainingUsd: 25 });
  });

  it('returns an unavailable state for non-finite runtime inputs', () => {
    const now = new Date(2026, 5, 17, 14, 30).getTime();
    expect(updateWeeklyState({ source: 'account', balanceUsd: 10 }, Number.NaN, now, null, '/tmp/ocstatusline-weekly-invalid-budget')).toEqual({ source: null, balanceUsd: null, budgetUsd: 0, spentUsd: 0, remainingUsd: 0, windowStartMs: 0, windowEndMs: 0 });
    expect(updateWeeklyState({ source: 'account', balanceUsd: 10 }, 25, Number.POSITIVE_INFINITY, null, '/tmp/ocstatusline-weekly-invalid-now')).toEqual({ source: null, balanceUsd: null, budgetUsd: 25, spentUsd: 0, remainingUsd: 0, windowStartMs: 0, windowEndMs: 0 });
  });

  it('does not carry account state into a new window before an account refresh', () => {
    const monday = new Date(2026, 5, 15, 12, 0).getTime();
    const nextMonday = new Date(2026, 5, 22, 12, 0).getTime();
    const path = `/tmp/ocstatusline-weekly-${Math.random()}.json`;
    const previous = updateWeeklyState({ source: 'account', balanceUsd: 25 }, 25, monday, null, path);
    const stale = updateWeeklyState(null, 25, nextMonday, previous, path);
    expect(stale.source).toBeNull();
    expect(stale.balanceUsd).toBeNull();
    expect(stale.remainingUsd).toBe(25);
    const limited = updateWeeklyState({ source: 'key-limit', balanceUsd: 4 }, 25, nextMonday, previous, path);
    expect(limited.source).toBe('key-limit');
    expect(limited.balanceUsd).toBe(4);
    expect(limited.remainingUsd).toBe(25);
  });

  it('uses monotonic usage for spend and ignores balance growth', () => {
    const now = new Date(2026, 5, 17, 14, 30).getTime();
    const path = `/tmp/ocstatusline-weekly-usage-${Math.random()}.json`;
    const first = updateWeeklyState({ source: 'account', balanceUsd: 48.667184 }, 100, 25, now, null, path);
    const second = updateWeeklyState({ source: 'account', balanceUsd: 105.565305 }, 106, 25, now, first, path);
    expect(second.spentUsd).toBe(6);
    expect(second.remainingUsd).toBe(19);
  });

  it('does not reduce spend when upstream usage decreases', () => {
    const now = new Date(2026, 5, 17, 14, 30).getTime();
    const path = `/tmp/ocstatusline-weekly-usage-decrease-${Math.random()}.json`;
    const first = updateWeeklyState({ source: 'account', balanceUsd: 20 }, 100, 25, now, null, path);
    const second = updateWeeklyState({ source: 'account', balanceUsd: 20 }, 106, 25, now, first, path);
    const decreased = updateWeeklyState({ source: 'account', balanceUsd: 20 }, 103, 25, now, second, path);
    expect(decreased.spentUsd).toBe(6);
    expect(decreased.usageAtStart).toBe(100);
  });

  it('preserves an existing usage anchor when a later observation is lower', () => {
    const now = new Date(2026, 5, 17, 14, 30).getTime();
    const path = `/tmp/ocstatusline-weekly-usage-anchor-${Math.random()}.json`;
    writeFileSync(path, JSON.stringify({ version: 2, windowStartMs: mondayStartMs(now), usageAtStart: 100, lastUsage: 110 }), 'utf8');
    const later = updateWeeklyState(null, 90, 25, now, null, path);
    expect(later.usageAtStart).toBe(100);
    expect(later.lastUsage).toBe(110);
    expect(later.spentUsd).toBe(10);
    rmSync(path, { force: true });
  });

  it('discards an invalid persisted v2 anchor and recovers spend from writer records', () => {
    const now = new Date(2026, 5, 17, 14, 30).getTime();
    const path = `/tmp/ocstatusline-weekly-corrupt-v2-${Math.random()}.json`;
    const windowStartMs = mondayStartMs(now);
    try {
      mkdirSync(`${path}.records`, { recursive: true });
      writeFileSync(path, JSON.stringify({ version: 2, windowStartMs, usageAtStart: -10, lastUsage: 5 }), 'utf8');
      writeFileSync(`${path}.records/recovery.json`, JSON.stringify({ version: 1, windowStartMs, usageAtStart: 100, observedUsage: 110, writerId: 'recovery' }), 'utf8');
      const state = updateWeeklyState(null, 105, 25, now, null, path);
      expect(state.usageAtStart).toBe(100);
      expect(state.lastUsage).toBe(110);
      expect(state.spentUsd).toBe(10);
    } finally {
      removeTestTree(path);
      removeTestTree(`${path}.records`);
    }
  });

  it('ignores a malformed negative writer anchor before reducing recovery records', () => {
    const now = new Date(2026, 5, 17, 14, 30).getTime();
    const path = `/tmp/ocstatusline-weekly-negative-record-${Math.random()}.json`;
    const windowStartMs = mondayStartMs(now);
    try {
      mkdirSync(`${path}.records`, { recursive: true });
      writeFileSync(`${path}.records/malformed.json`, JSON.stringify({ version: 1, windowStartMs, usageAtStart: -10, observedUsage: 100 }), 'utf8');
      const state = updateWeeklyState(null, 5, 25, now, null, path);
      expect(state.usageAtStart).toBe(5);
      expect(state.lastUsage).toBe(5);
      expect(state.spentUsd).toBe(0);
    } finally {
      removeTestTree(path);
      removeTestTree(`${path}.records`);
    }
  });

  it('preserves a writer high-water mark when replacing its record after state loss', () => {
    const now = new Date(2026, 5, 17, 14, 30).getTime();
    const path = `/tmp/ocstatusline-weekly-writer-high-water-${Math.random()}.json`;
    try {
      updateWeeklyState(null, 100, 25, now, null, path);
      updateWeeklyState(null, 110, 25, now, null, path);
      writeFileSync(path, '{corrupt', 'utf8');
      const recovered = updateWeeklyState(null, 105, 25, now, null, path);
      expect(recovered.usageAtStart).toBe(100);
      expect(recovered.lastUsage).toBe(110);
      expect(recovered.spentUsd).toBe(10);
    } finally {
      removeTestTree(path);
      removeTestTree(`${path}.records`);
    }
  });

  it('migrates a legacy balance anchor and preserves proven spend when balance falls', () => {
    const now = new Date(2026, 5, 17, 14, 30).getTime();
    const path = `/tmp/ocstatusline-weekly-legacy-${Math.random()}.json`;
    const legacy = updateWeeklyState({ source: 'account', balanceUsd: 48.667184 }, 25, now, null, path);
    const migrated = updateWeeklyState({ source: 'account', balanceUsd: 42.667184 }, 106, 25, now, legacy, path);
    expect(migrated.spentUsd).toBe(6);
    expect(migrated.remainingUsd).toBe(19);
    expect(migrated.usageAtStart).toBe(100);
  });

  it('keeps balance-derived spend when legacy migration would require a negative usage anchor', () => {
    const now = new Date(2026, 5, 17, 14, 30).getTime();
    const path = `/tmp/ocstatusline-weekly-legacy-low-usage-${Math.random()}.json`;
    try {
      writeFileSync(path, JSON.stringify({ windowStartMs: mondayStartMs(now), accountBalanceAtStartUsd: 48 }), 'utf8');
      const migrated = updateWeeklyState({ source: 'account', balanceUsd: 42 }, 3, 25, now, null, path);
      expect(migrated.spentUsd).toBe(6);
      expect(migrated.remainingUsd).toBe(19);
      expect(migrated.usageAtStart).toBeUndefined();
      expect(migrated.lastUsage).toBeUndefined();
    } finally {
      removeTestTree(path);
      removeTestTree(`${path}.records`);
    }
  });

  it('defers legacy migration while balance is unavailable and then preserves spend', () => {
    const now = new Date(2026, 5, 17, 14, 30).getTime();
    const path = `/tmp/ocstatusline-weekly-legacy-unavailable-${Math.random()}.json`;
    try {
      writeFileSync(path, JSON.stringify({ windowStartMs: mondayStartMs(now), accountBalanceAtStartUsd: 48 }), 'utf8');
      const pending = updateWeeklyState(null, 106, 25, now, null, path);
      expect(pending.spentUsd).toBe(0);
      const migrated = updateWeeklyState({ source: 'account', balanceUsd: 42 }, 110, 25, now, pending, path);
      expect(migrated.spentUsd).toBeGreaterThanOrEqual(6);
      expect(migrated.usageAtStart).toBe(104);
    } finally {
      rmSync(path, { force: true });
      rmSync(`${path}.records`, { recursive: true, force: true });
    }
  });

  it('defers legacy migration through key-limit and rebases after balance growth', () => {
    const now = new Date(2026, 5, 17, 14, 30).getTime();
    const path = `/tmp/ocstatusline-weekly-legacy-key-limit-${Math.random()}.json`;
    try {
      writeFileSync(path, JSON.stringify({ windowStartMs: mondayStartMs(now), accountBalanceAtStartUsd: 48 }), 'utf8');
      updateWeeklyState({ source: 'key-limit', balanceUsd: 4 }, 106, 25, now, null, path);
      const rebased = updateWeeklyState({ source: 'account', balanceUsd: 60 }, 110, 25, now, null, path);
      expect(rebased.spentUsd).toBe(0);
      expect(rebased.usageAtStart).toBe(110);
    } finally {
      rmSync(path, { force: true });
      rmSync(`${path}.records`, { recursive: true, force: true });
    }
  });

  it('resets a legacy anchor when balance grew and does not invent spend', () => {
    const now = new Date(2026, 5, 17, 14, 30).getTime();
    const path = `/tmp/ocstatusline-weekly-legacy-growth-${Math.random()}.json`;
    const legacy = updateWeeklyState({ source: 'account', balanceUsd: 48.667184 }, 25, now, null, path);
    const migrated = updateWeeklyState({ source: 'account', balanceUsd: 105.565305 }, 106, 25, now, legacy, path);
    expect(migrated.spentUsd).toBe(0);
    expect(migrated.remainingUsd).toBe(25);
    expect(migrated.usageAtStart).toBe(106);
  });

  it('merges a stale writer without reducing persisted usage', () => {
    const previous = { version: 2 as const, windowStartMs: 123, usageAtStart: 100, lastUsage: 110 };
    expect(mergeWeeklyUsageState(previous, 100, 106)).toEqual({ version: 2, windowStartMs: 123, usageAtStart: 100, lastUsage: 110 });
    expect(mergeWeeklyUsageState(previous, 100, 115)).toEqual({ version: 2, windowStartMs: 123, usageAtStart: 100, lastUsage: 115 });
  });

  it('starts a new usage anchor on Monday', () => {
    const monday = new Date(2026, 5, 15, 12, 0).getTime();
    const nextMonday = new Date(2026, 5, 22, 12, 0).getTime();
    const path = `/tmp/ocstatusline-weekly-new-window-${Math.random()}.json`;
    const previous = updateWeeklyState({ source: 'account', balanceUsd: 20 }, 100, 25, monday, null, path);
    const next = updateWeeklyState({ source: 'account', balanceUsd: 20 }, 103, 25, nextMonday, previous, path);
    expect(next.windowStartMs).toBe(mondayStartMs(nextMonday));
    expect(next.spentUsd).toBe(0);
    expect(next.usageAtStart).toBe(103);
  });

  it('recovers from a crashed writer without a shared lock', () => {
    const now = new Date(2026, 5, 17, 14, 30).getTime();
    const path = `/tmp/ocstatusline-weekly-stale-lock-${Math.random()}.json`;
    mkdirSync(dirname(path), { recursive: true });
    mkdirSync(`${path}.records`, { recursive: true });
    writeFileSync(`${path}.records/.crashed.tmp`, '{partial', 'utf8');
    try {
      expect(updateWeeklyState({ source: 'account', balanceUsd: 25 }, 25, now, null, path).remainingUsd).toBe(25);
      expect(readFileSync(path, 'utf8')).toContain('accountBalanceAtStartUsd');
    } finally {
      rmSync(path, { force: true });
      rmSync(`${path}.records`, { recursive: true, force: true });
    }
  });

  it('does not remove a live owner', async () => {
    const now = new Date(2026, 5, 17, 14, 30).getTime();
    const path = `/tmp/ocstatusline-weekly-live-owner-${process.pid}-${Date.now()}.json`;
    mkdirSync(dirname(path), { recursive: true });
    const barrier = `${path}.barrier`;
    const worker = spawnWorker([path, barrier, 'live', String(now), '100', '100']);
    try {
      await waitForPath(`${barrier}.ready-live`);
      mkdirSync(`${path}.lock`, { recursive: true });
      const identity = processStartSignature(worker.child.pid as number);
      writeFileSync(`${path}.lock/owner-${TOKENS.live}.json`, JSON.stringify(lockMetadata(worker.child.pid as number, TOKENS.live, identity.signature, identity.source)), 'utf8');
      expect(readFileSync(`${path}.lock/owner-${TOKENS.live}.json`, 'utf8')).toContain(TOKENS.live);
      expect(() => updateWeeklyState(null, 100, 25, now, null, path)).toThrow(/weekly state lock timeout/);
    } finally {
      try { rmSync(`${path}.lock`, { recursive: true, force: true }); } catch { /* best-effort test cleanup */ }
      try { writeFileSync(`${barrier}.release-live`, 'go', 'utf8'); } catch { /* best-effort test cleanup */ }
    }
    await withTimeout(worker.done);
    removeTestTree(path);
    removeTestTree(`${path}.records`);
    removeTestTree(`${path}.lock`);
    removeTestTree(`${barrier}.ready-live`);
    removeTestTree(barrier);
  });

  it('fails closed and bounded for malformed or ambiguous metadata', async () => {
    const now = new Date(2026, 5, 17, 14, 30).getTime();
    const identity = processStartSignature(process.pid);
    const cases = [
      { id: 'malformed', metadata: '' },
      { id: 'ambiguous', metadata: JSON.stringify(lockMetadata(process.pid, TOKENS.ambiguous, identity.signature, identity.source === 'ps' ? 'proc' : 'ps')) },
    ];
    for (const { id, metadata } of cases) {
      const path = `/tmp/ocstatusline-weekly-recovery-${process.pid}-${Date.now()}-${id}.json`;
      const barrier = `${path}.barrier`;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(barrier, 'go', 'utf8');
      mkdirSync(`${path}.lock`, { recursive: true });
      writeFileSync(`${path}.lock/owner-${TOKENS.ambiguous}.json`, metadata, 'utf8');
      try {
        const workerDone = withTimeout(spawnWorker([path, barrier, id, String(now), '100', '100']).done, 7_000);
        await expect(workerDone).rejects.toThrow(/worker exited|timeout/);
        expect(readFileSync(`${path}.lock/owner-${TOKENS.ambiguous}.json`, 'utf8')).toBe(metadata);
      } finally {
        rmSync(path, { force: true });
        rmSync(`${path}.records`, { recursive: true, force: true });
        rmSync(`${path}.lock`, { recursive: true, force: true });
        rmSync(barrier, { force: true });
      }
    }
  });

  it('detects PID reuse through the process start signature', async () => {
    const now = new Date(2026, 5, 17, 14, 30).getTime();
    const path = `/tmp/ocstatusline-weekly-pid-reuse-${process.pid}-${Date.now()}.json`;
    const barrier = `${path}.barrier`;
    mkdirSync(dirname(path), { recursive: true });
    mkdirSync(`${path}.lock`, { recursive: true });
    try {
      const identity = processStartSignature(process.pid);
      writeFileSync(`${path}.lock/owner-${TOKENS.reused}.json`, JSON.stringify(lockMetadata(process.pid, TOKENS.reused, 'different-process-start', identity.source)), 'utf8');
      updateWeeklyState(null, 100, 25, now, null, path);
      expect(readFileSync(path, 'utf8')).toContain('"version":2');
      expect(() => readFileSync(`${path}.lock/owner-${TOKENS.reused}.json`, 'utf8')).toThrow();
    } finally {
      removeTestTree(path);
      removeTestTree(`${path}.records`);
      removeTestTree(`${path}.lock`);
      removeTestTree(barrier);
    }
  });

  it('reduces stale and fresh writers by minimum anchor and maximum usage', () => {
    const now = new Date(2026, 5, 17, 14, 30).getTime();
    const path = `/tmp/ocstatusline-weekly-live-lock-${Math.random()}.json`;
    mkdirSync(dirname(path), { recursive: true });
    mkdirSync(`${path}.records`, { recursive: true });
    writeFileSync(`${path}.records/stale.json`, JSON.stringify({ version: 1, windowStartMs: mondayStartMs(now), usageAtStart: 100, observedUsage: 103 }), 'utf8');
    writeFileSync(`${path}.records/fresh.json`, JSON.stringify({ version: 1, windowStartMs: mondayStartMs(now), usageAtStart: 101, observedUsage: 106 }), 'utf8');
    try {
      const state = updateWeeklyState({ source: 'account', balanceUsd: 25 }, 104, 25, now, null, path);
      expect(state.usageAtStart).toBe(100);
      expect(state.lastUsage).toBe(106);
      expect(state.spentUsd).toBe(6);
    } finally {
      rmSync(path, { force: true });
      rmSync(`${path}.records`, { recursive: true, force: true });
    }
  });

  it('ignores incomplete record files left by a crashed writer', () => {
    const now = new Date(2026, 5, 17, 14, 30).getTime();
    const path = `/tmp/ocstatusline-weekly-malformed-lock-${Math.random()}.json`;
    mkdirSync(dirname(path), { recursive: true });
    mkdirSync(`${path}.records`, { recursive: true });
    writeFileSync(`${path}.records/.writer.tmp`, '{not-json', 'utf8');
    try {
      expect(updateWeeklyState({ source: 'account', balanceUsd: 25 }, 25, now, null, path).remainingUsd).toBe(25);
      expect(readFileSync(path, 'utf8')).toContain('accountBalanceAtStartUsd');
    } finally {
      rmSync(path, { force: true });
      rmSync(`${path}.records`, { recursive: true, force: true });
    }
  });

  it('replaces the same writer record instead of growing the record set', () => {
    const now = new Date(2026, 5, 17, 14, 30).getTime();
    const path = `/tmp/ocstatusline-weekly-stable-writer-${Math.random()}.json`;
    try {
      updateWeeklyState({ source: 'account', balanceUsd: 25 }, 100, 25, now, null, path);
      updateWeeklyState({ source: 'account', balanceUsd: 25 }, 106, 25, now, null, path);
      expect(readdirSync(`${path}.records`).filter((name) => name.endsWith('.json'))).toHaveLength(1);
    } finally {
      rmSync(path, { force: true });
      rmSync(`${path}.records`, { recursive: true, force: true });
    }
  });

  it('releases and reacquires the weekly lock without leaving its own artifact', () => {
    const now = new Date(2026, 5, 17, 14, 30).getTime();
    const path = `/tmp/ocstatusline-weekly-lock-released-${process.pid}-${Date.now()}.json`;
    const releasedPrefix = `${basename(path)}.lock.released-`;
    try {
      expect(updateWeeklyState({ source: 'account', balanceUsd: 25 }, 100, 25, now, null, path).spentUsd).toBe(0);
      expect(updateWeeklyState({ source: 'account', balanceUsd: 24 }, 101, 25, now, null, path).spentUsd).toBe(1);
      expect(updateWeeklyState({ source: 'account', balanceUsd: 23 }, 102, 25, now, null, path).spentUsd).toBe(2);
      expect(updateWeeklyState({ source: 'account', balanceUsd: 22 }, 103, 25, now, null, path).spentUsd).toBe(3);
      expect(readdirSync(dirname(path)).filter((name) => name.startsWith(releasedPrefix))).toHaveLength(0);
    } finally {
      removeTestTree(path);
      removeTestTree(`${path}.records`);
      removeTestTree(`${path}.lock`);
    }
  });

  it('removes only an exact empty released artifact left after cleanup crashed', () => {
    const now = new Date(2026, 5, 17, 14, 30).getTime();
    const path = `/tmp/ocstatusline-weekly-empty-released-${process.pid}-${Date.now()}.json`;
    const released = `${path}.lock.released-${TOKENS.stale}`;
    const candidate = `${path}.lock.candidate-${TOKENS.live}`;
    try {
      mkdirSync(released, { recursive: true });
      mkdirSync(candidate, { recursive: true });
      expect(updateWeeklyState(null, 100, 25, now, null, path).spentUsd).toBe(0);
      expect(existsSync(released)).toBe(false);
      expect(existsSync(candidate)).toBe(true);
    } finally {
      removeTestTree(path);
      removeTestTree(`${path}.records`);
      removeTestTree(`${path}.lock`);
      removeTestTree(released);
      removeTestTree(candidate);
    }
  });

  it('preserves weekly invariants across concurrent OS-process writers', async () => {
    const now = new Date(2026, 5, 17, 14, 30).getTime();
    const root = join('/tmp', `ocstatusline-weekly-concurrent-${process.pid}-${Date.now()}`);
    const statePath = join(root, 'state.json');
    const barrierPath = join(root, 'start');
    const heldPath = join(root, 'lock-held');
    const observedPath = join(root, 'lock-observed');
    const releasePath = join(root, 'lock-release');
    const workers = [
      { anchor: 100, observed: 103 },
      { anchor: 101, observed: 111 },
    ];
    mkdirSync(root, { recursive: true });
    const processes: { child: ReturnType<typeof execFile>; done: Promise<void> }[] = [spawnWorker([statePath, barrierPath, '0', String(now), String(workers[0].anchor), String(workers[0].observed)], {
      OCSTATUSLINE_WEEKLY_TEST_LOCK_HELD_PATH: heldPath,
      OCSTATUSLINE_WEEKLY_TEST_LOCK_RELEASE_PATH: releasePath,
    })];
    try {
      const readyDeadline = Date.now() + 5_000;
      while (!existsSync(`${barrierPath}.ready-0`) && Date.now() < readyDeadline) await new Promise((resolve) => setImmediate(resolve));
      expect(existsSync(`${barrierPath}.ready-0`)).toBe(true);
      writeFileSync(`${barrierPath}.go-0`, 'go', 'utf8');
      await waitForPath(heldPath);
      processes.push(spawnWorker([statePath, barrierPath, '1', String(now), String(workers[1].anchor), String(workers[1].observed)], {
        OCSTATUSLINE_WEEKLY_TEST_LOCK_OBSERVED_PATH: observedPath,
      }));
      await waitForPath(`${barrierPath}.ready-1`);
      writeFileSync(`${barrierPath}.go-1`, 'go', 'utf8');
      await waitForPath(observedPath);
      writeFileSync(releasePath, 'go', 'utf8');
      await withTimeout(Promise.all(processes.map(({ done }) => done)));

      const state = JSON.parse(readFileSync(statePath, 'utf8')) as { version: number; windowStartMs: number; usageAtStart: number; lastUsage: number };
      expect(JSON.parse(readFileSync(heldPath, 'utf8')).lockPath).toBe(`${statePath}.lock`);
      expect(JSON.parse(readFileSync(observedPath, 'utf8')).lockPath).toBe(`${statePath}.lock`);
      const recordNames = readdirSync(`${statePath}.records`);
      const recordValues = recordNames.filter((name) => name.endsWith('.json')).map((name) => JSON.parse(readFileSync(join(`${statePath}.records`, name), 'utf8')) as { version: number; windowStartMs: number; usageAtStart?: number; observedUsage?: number });
      expect(state.version).toBe(2);
      expect(state.windowStartMs).toBe(mondayStartMs(now));
      expect(state.usageAtStart).toBe(Math.min(...workers.map(({ anchor }) => anchor)));
      expect(state.lastUsage).toBe(Math.max(...workers.map(({ observed }) => observed)));
      expect(recordValues).toHaveLength(workers.length);
      expect(recordValues.every((record) => record.version === 1 && record.windowStartMs === state.windowStartMs)).toBe(true);
      expect(Math.min(...recordValues.map((record) => record.usageAtStart ?? Number.POSITIVE_INFINITY))).toBe(state.usageAtStart);
      expect(Math.max(...recordValues.map((record) => record.observedUsage ?? Number.NEGATIVE_INFINITY))).toBe(state.lastUsage);
      expect(readdirSync(root, { recursive: true }).some((name) => String(name).endsWith('.tmp'))).toBe(false);
      expect(JSON.parse(readFileSync(statePath, 'utf8'))).toEqual(state);
    } finally {
      writeFileSync(releasePath, 'go', 'utf8');
      await withTimeout(Promise.all(processes.map(({ done }) => done.catch(() => undefined))), 7_000);
      rmSync(root, { recursive: true, force: true });
    }
  }, 45_000);

  it('lets concurrent processes recover one malformed lock without deleting the replacement owner', async () => {
    const now = new Date(2026, 5, 17, 14, 30).getTime();
    const root = join('/tmp', `ocstatusline-weekly-lock-recovery-${process.pid}-${Date.now()}`);
    const statePath = join(root, 'state.json');
    const barrierPath = join(root, 'start');
    mkdirSync(root, { recursive: true });
    mkdirSync(`${statePath}.lock`, { recursive: true });
    writeFileSync(`${statePath}.lock/owner-${TOKENS.stale}.json`, JSON.stringify(lockMetadata(process.pid + 100000, TOKENS.stale, 'dead-process-start', 'ps')), 'utf8');
    const workers = [
      { id: 'first', ...spawnWorker([statePath, barrierPath, 'first', String(now), '100', '100']) },
      { id: 'second', ...spawnWorker([statePath, barrierPath, 'second', String(now), '101', '101']) },
    ];
    try {
      await Promise.all(workers.map(({ id }) => waitForPath(`${barrierPath}.ready-${id}`)));
      writeFileSync(`${barrierPath}.go-first`, 'go', 'utf8');
      await withTimeout(workers[0].done);
      writeFileSync(`${barrierPath}.go-second`, 'go', 'utf8');
      await withTimeout(workers[1].done);
      const records = readdirSync(`${statePath}.records`).filter((name) => name.endsWith('.json'));
      expect(records).toHaveLength(2);
      expect(readFileSync(statePath, 'utf8')).toContain('"version":2');
      expect(existsSync(`${statePath}.lock`)).toBe(false);

      mkdirSync(`${statePath}.lock`, { recursive: true });
      writeFileSync(`${statePath}.lock/owner-${TOKENS.replacement}.json`, JSON.stringify(lockMetadata(process.pid, TOKENS.replacement, processStartSignature(process.pid).signature, processStartSignature(process.pid).source)), 'utf8');
      const oldOwner = spawnWorker([statePath, `${root}/old-owner`, 'old', String(now), '102', '102']);
      try {
        await waitForPath(`${root}/old-owner.ready-old`);
        writeFileSync(`${root}/old-owner`, 'go', 'utf8');
        await expect(oldOwner.done).rejects.toThrow(/weekly state lock timeout/);
        expect(readFileSync(`${statePath}.lock/owner-${TOKENS.replacement}.json`, 'utf8')).toContain(TOKENS.replacement);
      } finally {
        try { oldOwner.child.kill('SIGKILL'); } catch { /* best-effort test cleanup */ }
        await oldOwner.done.catch(() => undefined);
      }
    } finally {
      try { writeFileSync(barrierPath, 'go', 'utf8'); } catch { /* best-effort test cleanup */ }
      removeTestTree(root);
    }
  }, 45_000);

  it('persists a rebased legacy anchor while usage is unavailable', () => {
    const now = new Date(2026, 5, 17, 14, 30).getTime();
    const path = `/tmp/ocstatusline-weekly-legacy-pending-${Math.random()}.json`;
    try {
      updateWeeklyState({ source: 'account', balanceUsd: 48 }, 25, now, null, path);
      const rebased = updateWeeklyState({ source: 'account', balanceUsd: 60 }, null, 25, now, null, path);
      expect(rebased.spentUsd).toBe(0);
      writeFileSync(path, JSON.stringify({ windowStartMs: mondayStartMs(now), accountBalanceAtStartUsd: 48 }), 'utf8');
      const recovered = updateWeeklyState({ source: 'account', balanceUsd: 54 }, 120, 25, now, rebased, path);
      expect(recovered.spentUsd).toBe(6);
      expect(recovered.usageAtStart).toBe(114);
    } finally {
      rmSync(path, { force: true });
      rmSync(`${path}.records`, { recursive: true, force: true });
      rmSync(`${path}.lock`, { force: true });
    }
  });
});

function runtimeForTests(): string { return process.versions.bun ? process.execPath : join(process.cwd(), 'node_modules/.bin/vite-node'); }
function workerPathForTests(): string { return join(process.cwd(), 'tests/data/openrouter-weekly-worker.ts'); }
function processStartSignature(pid: number | undefined): { source: 'ps' | 'proc'; signature: string } { if (!pid) throw new Error('worker pid unavailable'); try { const value = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8' }).trim(); if (value) return { source: 'ps', signature: value }; } catch { /* use /proc in minimal test images */ } const stat = readFileSync(`/proc/${pid}/stat`, 'utf8'); const commandEnd = stat.lastIndexOf(')'); const fields = commandEnd >= 0 ? stat.slice(commandEnd + 2).trim().split(/\s+/) : []; if (fields.length <= 19 || !fields[19]) throw new Error(`process ${pid} has no start signature`); return { source: 'proc', signature: fields[19] }; }
function lockMetadata(pid: number, token: string, startSignature: string, startSignatureSource: 'ps' | 'proc'): { version: 1; pid: number; token: string; startSignature: string; startSignatureSource: 'ps' | 'proc' } { return { version: 1, pid, token, startSignature, startSignatureSource }; }
