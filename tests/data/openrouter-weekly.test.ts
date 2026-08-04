import { describe, expect, it } from 'vitest';
import { accountBalanceSeverity, mondayStartMs, updateWeeklyState, weeklyBalanceSeverity } from '../../src/data/openrouter-weekly';

describe('OpenRouter weekly window', () => {
  it('uses five remaining-budget color levels only for account state', () => {
    const account = { source: 'account' as const, budgetUsd: 25, remainingUsd: 2 };
    expect(weeklyBalanceSeverity(account)).toBe('dark-red');
    expect(weeklyBalanceSeverity({ ...account, remainingUsd: 5 })).toBe('orange');
    expect(weeklyBalanceSeverity({ ...account, remainingUsd: 10 })).toBe('muted-green');
    expect(weeklyBalanceSeverity({ ...account, remainingUsd: 15 })).toBe('teal');
    expect(weeklyBalanceSeverity({ ...account, remainingUsd: 20 })).toBe('sky-blue');
    expect(weeklyBalanceSeverity({ ...account, source: 'key-limit', remainingUsd: 1 })).toBe('neutral');
  });

  it('classifies the full account balance against the weekly budget', () => {
    const account = { source: 'account' as const, budgetUsd: 25, balanceUsd: 25 };
    expect(accountBalanceSeverity(account)).toBe('sky-blue');
    expect(accountBalanceSeverity({ ...account, balanceUsd: 10 })).toBe('muted-green');
    expect(accountBalanceSeverity({ ...account, balanceUsd: 2 })).toBe('dark-red');
    expect(accountBalanceSeverity({ ...account, source: 'key-limit' })).toBe('neutral');
    expect(accountBalanceSeverity({ ...account, balanceUsd: null })).toBe('neutral');
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
