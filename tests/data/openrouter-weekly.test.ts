import { describe, expect, it } from 'vitest';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { accountBalanceSeverity, mergeWeeklyUsageState, mondayStartMs, updateWeeklyState, weeklyBalanceSeverity } from '../../src/data/openrouter-weekly';

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
    const state = updateWeeklyState({ source: 'account', balanceUsd: 20 }, 25, now, null, '/tmp/ocstatusline-weekly-test-missing');
    expect(new Date(start).getDay()).toBe(1);
    expect(new Date(start).getHours()).toBe(0);
    expect(state.windowEndMs).toBeGreaterThan(start);
    expect(state.spentUsd).toBe(0);
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
