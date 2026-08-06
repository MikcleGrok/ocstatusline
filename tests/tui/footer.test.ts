import { describe, expect, it } from 'vitest';
import { formatTuiFooter, formatTuiFooterSegments, formatTuiModelCost, formatTuiProductionVersion, getTuiGitInfo, gitInfoForRoute, parseTuiGitInfo, tuiFooterColor, tuiRouteKey, tuiRouteSnapshot } from '../../src/tui/footer.js';

describe('TUI footer', () => {
  const git = { isRepo: true, root: '/work/sender', branch: 'DEV-15309' };

  it('formats model tariffs compactly without trailing zeroes', () => {
    expect(formatTuiModelCost({ cost: { input: 0.15, output: 0.6, cache_read: 0.02, cache_write: 0.3 }, contextLength: 1_000_000 })).toEqual({ text: '$0.15/0.6 · 1M', color: 'gray' });
    expect(formatTuiModelCost({ cost: { input: 0.15, output: 0.6, cache: { read: 0.02, write: 0.3 } }, limit: { context: 1_000_000 } })).toEqual({ text: '$0.15/0.6 · 1M', color: 'gray' });
  });

  it('omits the context suffix when the model does not provide a context limit', () => {
    expect(formatTuiModelCost({ cost: { input: 0.15, output: 0.6, cache_read: 0.02, cache_write: 0.3 } })).toEqual({ text: '$0.15/0.6', color: 'gray' });
  });

  it('shows a complete experimental tier and context suffix', () => {
    expect(formatTuiModelCost({ cost: { input: 0.15, output: 0.6, cache: { read: 0.02, write: 0.3 }, experimentalOver200K: { input: 0.3, output: 1.2, cache: { read: 0.04, write: 0.6 } } }, contextLength: 1_000_000 })).toEqual({ text: '$0.15/0.6 | $0.3/1.2 >200K · 1M', color: 'gray' });
  });

  it('hides missing or invalid model tariffs', () => {
    expect(formatTuiModelCost(null)).toBeNull();
    expect(formatTuiModelCost({ cost: { input: Number.NaN, output: -1 } })).toBeNull();
    expect(formatTuiModelCost({ cost: { input: 0.15, output: Number.POSITIVE_INFINITY } })).toBeNull();
  });

  it('hides an incomplete experimental tier without hiding a complete base tariff', () => {
    expect(formatTuiModelCost({ cost: { input: 0.15, output: 0.6, cache: { read: 0.02, write: 0.3 }, experimentalOver200K: { input: 0.3, output: 1.2, cache: { read: 0.04 } } } })).toEqual({ text: '$0.15/0.6', color: 'gray' });
  });

  it('hides the complete model tariff when the base tier is incomplete', () => {
    expect(formatTuiModelCost({ cost: { input: 0.15, output: 0.6, cache: { read: 0.02 }, experimentalOver200K: { input: 0.3, output: 1.2, cache: { read: 0.04, write: 0.6 } } } })).toBeNull();
  });

  it('formats the exact custom line from the git root basename and branch', () => {
    expect(formatTuiFooter(47.78, git)).toBe('$47.78 · sender · DEV-15309');
  });

  it('uses ? for an unavailable balance', () => {
    expect(formatTuiFooter(null, git)).toBe('? · sender · DEV-15309');
  });
  it('formats production version as a separate footer segment', () => {
    expect(formatTuiProductionVersion('2026.08.04')).toEqual({ text: 'prod 2026.08.04', color: 'gray' });
    expect(formatTuiFooterSegments(null, git, undefined, '2026.08.04')).toEqual([
      { text: '?', color: 'gray' }, { text: 'sender · DEV-15309', color: 'gray' }, { text: 'prod 2026.08.04', color: 'gray' },
    ]);
  });

  it('uses ? for non-finite balances before formatting', () => {
    expect(formatTuiFooter(Number.NaN, git)).toBe('? · sender · DEV-15309');
    expect(formatTuiFooter(Number.POSITIVE_INFINITY, git)).toBe('? · sender · DEV-15309');
    const weekly = { source: 'account' as const, balanceUsd: Number.NaN, budgetUsd: 25, spentUsd: 0, remainingUsd: Number.NaN, windowStartMs: 0, windowEndMs: 1 };
    expect(formatTuiFooter(weekly, git)).toBe('? · sender · DEV-15309');
    expect(formatTuiFooterSegments(weekly, git)).toEqual([{ text: '?', color: 'gray' }, { text: 'sender · DEV-15309', color: 'gray' }]);
  });

  it('fails closed when weekly timing or spend is non-finite', () => {
    const weekly = { source: 'account' as const, balanceUsd: 10, budgetUsd: 25, spentUsd: Number.POSITIVE_INFINITY, remainingUsd: 10, windowStartMs: 0, windowEndMs: 100 };
    expect(formatTuiFooterSegments(weekly, git, 50)).toEqual([{ text: '?', color: 'gray' }, { text: 'sender · DEV-15309', color: 'gray' }]);
  });

  it('formats the account weekly remaining balance instead of the account balance', () => {
    const weekly = { source: 'account' as const, balanceUsd: 49.46844, budgetUsd: 25, spentUsd: 0, remainingUsd: 25, windowStartMs: 0, windowEndMs: 1 };
    expect(formatTuiFooter(weekly, git)).toBe('$25.00 · sender · DEV-15309');
  });

  it('formats weekly overspend as a negative value and uses its dedicated color', () => {
    const weekly = { source: 'account' as const, balanceUsd: 0, budgetUsd: 25, spentUsd: 26.25, remainingUsd: 0, windowStartMs: 0, windowEndMs: 100 };
    expect(formatTuiFooter(weekly, git)).toBe('-$1.25 · sender · DEV-15309');
    expect(tuiFooterColor(weekly, 50)).toBe(201);
    expect(formatTuiFooterSegments(weekly, git, 50)[0]).toEqual({ text: '-$1.25', color: 201 });
  });

  it('uses the same burn-rate classification as the standalone renderer', () => {
    const weekly = { source: 'account' as const, balanceUsd: 2, budgetUsd: 25, spentUsd: 23, remainingUsd: 2, windowStartMs: 0, windowEndMs: 100 };
    expect(tuiFooterColor(weekly, 50)).toBe(124);
    expect(tuiFooterColor({ ...weekly, remainingUsd: 20, spentUsd: 5 }, 1)).toBe(124);
    expect(tuiFooterColor({ ...weekly, remainingUsd: 20, spentUsd: 5 }, 100)).toBe(75);
  });

  it('keeps the complete formatter ANSI-256 palette stable', () => {
    const weekly = { source: 'account' as const, balanceUsd: 2, budgetUsd: 25, spentUsd: 23, remainingUsd: 2, windowStartMs: 0, windowEndMs: 1 };
    expect(tuiFooterColor(weekly, 0.5)).toBe(124);
  });

  it('accepts an injected clock for exact footer boundaries', () => {
    const weekly = { source: 'account' as const, balanceUsd: 25, budgetUsd: 100, spentUsd: 0, remainingUsd: 100, windowStartMs: 0, windowEndMs: 100 };
    expect(tuiFooterColor({ ...weekly, spentUsd: 20, remainingUsd: 80 }, 50)).toBe(75);
    expect(tuiFooterColor({ ...weekly, spentUsd: 33.335, remainingUsd: 66.665 }, 50)).toBe(37);
    expect(tuiFooterColor({ ...weekly, spentUsd: 50, remainingUsd: 50 }, 50)).toBe(71);
  });

  it('renders missing weekly timing as neutral gray', () => {
    const weekly = { source: 'account' as const, balanceUsd: 2, budgetUsd: 25, spentUsd: 23, remainingUsd: 2, windowStartMs: 0, windowEndMs: 100 };
    expect(tuiFooterColor(weekly)).toBe('gray');
    expect(tuiFooterColor({ ...weekly, spentUsd: Number.NaN }, 50)).toBe('gray');
  });

  it('formats weekly remaining and full account balance as separate segments', () => {
    const weekly = { source: 'account' as const, balanceUsd: 49.46844, budgetUsd: 25, spentUsd: 0, remainingUsd: 25, windowStartMs: 0, windowEndMs: 1 };
    expect(formatTuiFooterSegments(weekly, git, 0)).toEqual([
      { text: '$25.00', color: 75 },
      { text: 'sender · DEV-15309', color: 'gray' },
      { text: '$49', color: 75 },
    ]);
    expect(formatTuiFooterSegments(weekly, git, 0).map((segment) => segment.text).join(' · ')).not.toContain('\n');
    expect(formatTuiFooterSegments(weekly, git, 0).map((segment) => segment.text)).not.toContain('total $49');
  });

  it('rounds the account balance to the nearest whole dollar', () => {
    const weekly = { source: 'account' as const, balanceUsd: 49.5, budgetUsd: 25, spentUsd: 0, remainingUsd: 25, windowStartMs: 0, windowEndMs: 1 };
    expect(formatTuiFooterSegments(weekly, git, 0)[2]).toEqual({ text: '$50', color: 75 });
  });

  it('does not color key-limit or unavailable balances as weekly alerts', () => {
    const weekly = { source: 'key-limit' as const, balanceUsd: 1, budgetUsd: 25, spentUsd: 0, remainingUsd: 1, windowStartMs: 0, windowEndMs: 1 };
    expect(tuiFooterColor(weekly)).toBe('gray');
    expect(formatTuiFooter(weekly, git)).toBe('? · sender · DEV-15309');
    expect(formatTuiFooterSegments(weekly, git).map((segment) => segment.text)).toEqual(['?', 'sender · DEV-15309']);
    expect(formatTuiFooter({ ...weekly, source: null, balanceUsd: null }, git)).toBe('? · sender · DEV-15309');
  });

  it('is empty when the route is not in a git repository', () => {
    expect(formatTuiFooter(47.78, { isRepo: false, root: null, branch: null })).toBe('');
  });

  it('parses preloaded git output without side effects', () => {
    expect(parseTuiGitInfo('# branch.head DEV-15309\n# branch.oid abcdef123456\n', '/work/sender\n')).toEqual(git);
  });

  it('handles a directory without git safely', async () => {
    await expect(getTuiGitInfo('/tmp')).resolves.toEqual({ isRepo: false, root: null, branch: null });
  });

  it('does not include built-in footer widgets', () => {
    const line = formatTuiFooter(47.78, git);
    expect(line).not.toMatch(/model|context|cost|timer|qwen|ctx|session/i);
  });

  it('changes the git state key when the route session or cwd changes', () => {
    expect(tuiRouteKey({ name: 'session', params: { sessionID: 'a' } }, '/repo')).toBe('session:a:/repo');
    expect(tuiRouteKey({ name: 'session', params: { sessionID: 'b' } }, '/repo')).toBe('session:b:/repo');
    expect(tuiRouteKey({ name: 'session', params: { sessionID: 'a' } }, '/other')).toBe('session:a:/other');
  });

  it('loads git state for home using the current project directory', () => {
    expect(tuiRouteKey({ name: 'home' }, '/repo')).toBe('home::/repo');
    expect(tuiRouteKey({ name: 'home' }, '')).toBeNull();
    expect(tuiRouteKey({ name: 'home' }, '/repo')).not.toBe(tuiRouteKey({ name: 'session', params: { sessionID: 'a' } }, '/repo'));
  });

  it('uses the session workspace for the route snapshot without mixing home git state', () => {
    const state = {
      path: { directory: '/home-project' },
      session: { get: (sessionID: string) => sessionID === 'session-1' ? { directory: '  /session-worktree  ' } : undefined },
    };
    const home = tuiRouteSnapshot({ name: 'home' }, state);
    const session = tuiRouteSnapshot({ name: 'session', params: { sessionID: 'session-1' } }, state);

    expect(home).toEqual({ cwd: '/home-project', key: 'home::/home-project' });
    expect(session).toEqual({ cwd: '/session-worktree', key: 'session:session-1:/session-worktree' });
    expect(session.key).not.toBe(home.key);
    expect(gitInfoForRoute(session.key, home.key, git)).toEqual({ isRepo: false, root: null, branch: null });
  });

  it('does not fall back to the home workspace when the session is not loaded', () => {
    const state = {
      path: { directory: '/home-project' },
      session: { get: () => undefined },
    };

    expect(tuiRouteSnapshot({ name: 'session', params: { sessionID: 'missing' } }, state)).toEqual({ cwd: null, key: null });
  });

  it('does not fall back to the home workspace when the session directory is invalid', () => {
    const state = {
      path: { directory: '/home-project' },
      session: { get: () => ({ directory: '   ' }) },
    };

    const snapshot = tuiRouteSnapshot({ name: 'session', params: { sessionID: 'invalid' } }, state);
    expect(snapshot).toEqual({ cwd: null, key: null });
    expect(gitInfoForRoute(snapshot.key, 'home::/home-project', git)).toEqual({ isRepo: false, root: null, branch: null });
  });

  it('rejects stale git state when its key does not match the current route', () => {
    expect(gitInfoForRoute('session:b:/repo-b', 'session:a:/repo-a', git)).toEqual({ isRepo: false, root: null, branch: null });
    expect(gitInfoForRoute('session:a:/repo-a', 'session:a:/repo-a', git)).toBe(git);
  });
});
