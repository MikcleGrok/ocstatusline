import { describe, expect, it } from 'vitest';
import { accountBalanceSeverity, mondayStartMs, updateWeeklyState, weeklyBalanceSeverity } from '../../src/data/openrouter-weekly';

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
    expect(weeklyBalanceSeverity({ ...state, spentUsd: 29, remainingUsd: 0 }, 100)).toBe('dark-red');
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
});
