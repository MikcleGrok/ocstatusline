import { basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseGit } from '../data/git.js';
import { weeklyBalanceSeverity } from '../data/openrouter-weekly.js';
import type { OpenRouterWeeklyContext } from '../types/index.js';

const execFileAsync = promisify(execFile);

export interface TuiGitInfo {
  isRepo: boolean;
  root: string | null;
  branch: string | null;
}

export function parseTuiGitInfo(status: string, rootOutput: string): TuiGitInfo {
  const git = parseGit(status);
  const root = rootOutput.trim();
  return { isRepo: git.isRepo && root.length > 0 && git.branch !== null, root: root || null, branch: git.branch };
}

export async function getTuiGitInfo(cwd: string | null, signal?: AbortSignal): Promise<TuiGitInfo> {
  if (!cwd) return { isRepo: false, root: null, branch: null };
  try {
    const [{ stdout: status }, { stdout: rootOutput }] = await Promise.all([
      execFileAsync('git', ['status', '--porcelain=v2', '--branch', '--untracked-files=all'], { cwd, encoding: 'utf-8', signal }),
      execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf-8', signal }),
    ]);
    return parseTuiGitInfo(status, rootOutput);
  } catch {
    return { isRepo: false, root: null, branch: null };
  }
}

export type TuiFooterBalance = number | null | OpenRouterWeeklyContext;

function footerBalanceValue(balance: TuiFooterBalance): number | null {
  return typeof balance === 'number' || balance === null ? balance : balance.balanceUsd;
}

export function tuiFooterColor(balance: TuiFooterBalance): 'gray' | 'yellow' | 'red' {
  if (typeof balance === 'number' || balance === null) return 'gray';
  const severity = weeklyBalanceSeverity(balance);
  return severity === 'critical' ? 'red' : severity === 'warning' ? 'yellow' : 'gray';
}

export function formatTuiFooter(balance: TuiFooterBalance, git: TuiGitInfo): string {
  if (!git.isRepo || !git.root || !git.branch) return '';
  const value = footerBalanceValue(balance);
  const balanceText = value === null ? '?' : `$${value.toFixed(2)}`;
  return `${balanceText} · ${basename(git.root)} · ${git.branch}`;
}

export function tuiRouteKey(route: { name?: unknown; params?: { sessionID?: unknown } } | undefined, cwd: unknown): string | null {
  if ((route?.name !== 'home' && route?.name !== 'session') || typeof cwd !== 'string' || !cwd) return null;
  const sessionID = route.name === 'session' && typeof route.params?.sessionID === 'string' ? route.params.sessionID : '';
  return `${route.name}:${sessionID}:${cwd}`;
}

export interface TuiRouteSnapshot {
  cwd: string | null;
  key: string | null;
}

export function tuiRouteSnapshot(
  route: { name?: unknown; params?: { sessionID?: unknown } } | undefined,
  state: { path?: { directory?: unknown }; session?: { get?: (sessionID: string) => unknown } },
): TuiRouteSnapshot {
  const homeCwd = state.path?.directory;
  let cwd = route?.name === 'home' && typeof homeCwd === 'string' && homeCwd ? homeCwd : null;
  if (route?.name === 'session' && typeof route.params?.sessionID === 'string') {
    const session = state.session?.get?.(route.params.sessionID);
    if (session && typeof session === 'object' && typeof (session as { directory?: unknown }).directory === 'string') {
      const sessionDirectory = (session as { directory: string }).directory.trim();
      if (sessionDirectory) cwd = sessionDirectory;
    }
  }
  return { cwd, key: tuiRouteKey(route, cwd) };
}

const EMPTY_GIT: TuiGitInfo = { isRepo: false, root: null, branch: null };

export function gitInfoForRoute(currentKey: string | null, gitKey: string | null, git: TuiGitInfo): TuiGitInfo {
  return currentKey !== null && currentKey === gitKey ? git : EMPTY_GIT;
}
