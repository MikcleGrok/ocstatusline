import { describe, expect, it } from 'vitest';
import { formatTuiFooter, getTuiGitInfo, parseTuiGitInfo } from '../../src/tui/footer.js';
import { gitInfoForRoute, tuiRouteKey, tuiRouteSnapshot } from '../../.opencode/tui-plugins/ocstatusline.js';

describe('TUI footer', () => {
  const git = { isRepo: true, root: '/work/sender', branch: 'DEV-15309' };

  it('formats the exact custom line from the git root basename and branch', () => {
    expect(formatTuiFooter(47.78, git)).toBe('$47.78 · sender · DEV-15309');
  });

  it('uses ? for an unavailable balance', () => {
    expect(formatTuiFooter(null, git)).toBe('? · sender · DEV-15309');
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
