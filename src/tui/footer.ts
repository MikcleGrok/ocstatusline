import { basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseGit } from '../data/git.js';
import { accountBalanceSeverity, weeklyBalanceSeverity } from '../data/openrouter-weekly.js';
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

export interface TuiFooterSegment {
  text: string;
  color: 'gray' | number;
}

export function formatTuiProductionVersion(version: string | null): TuiFooterSegment | null {
  return version ? { text: `prod ${version}`, color: 'gray' } : null;
}

function isAccountWeeklyBalance(balance: TuiFooterBalance): balance is OpenRouterWeeklyContext & { source: 'account' } {
  return typeof balance === 'object' && balance !== null && balance.source === 'account' && Number.isFinite(balance.remainingUsd) && Number.isFinite(balance.budgetUsd) && Number.isFinite(balance.spentUsd) && Number.isFinite(balance.windowStartMs) && Number.isFinite(balance.windowEndMs);
}

function footerBalanceValue(balance: TuiFooterBalance): number | null {
  if (balance === null) return null;
  if (typeof balance === 'number') return Number.isFinite(balance) ? balance : null;
  return isAccountWeeklyBalance(balance) ? balance.remainingUsd : null;
}

function severityColor(severity: ReturnType<typeof weeklyBalanceSeverity>): 'gray' | number {
  return severity === 'neutral' ? 'gray' : ({ 'sky-blue': 75, teal: 37, 'muted-green': 71, orange: 208, 'dark-red': 124 } as const)[severity];
}

export function tuiFooterColor(balance: TuiFooterBalance, nowMs?: number): 'gray' | number {
  if (typeof balance === 'number' || balance === null) return 'gray';
  if (!isAccountWeeklyBalance(balance)) return 'gray';
  return severityColor(weeklyBalanceSeverity(balance, nowMs));
}

export function formatTuiFooterSegments(balance: TuiFooterBalance, git: TuiGitInfo, nowMs?: number, productionVersion: string | null = null): TuiFooterSegment[] {
  if (!git.isRepo || !git.root || !git.branch) return [];
  const value = footerBalanceValue(balance);
  const weeklyText = value === null ? '?' : `$${value.toFixed(2)}`;
  const segments: TuiFooterSegment[] = [
    { text: weeklyText, color: tuiFooterColor(balance, nowMs) },
    { text: `${basename(git.root)} · ${git.branch}`, color: 'gray' },
  ];
  if (isAccountWeeklyBalance(balance) && balance.balanceUsd !== null && Number.isFinite(balance.balanceUsd)) {
    segments.push({ text: `$${Math.round(balance.balanceUsd)}`, color: severityColor(accountBalanceSeverity(balance)) });
  }
  const production = formatTuiProductionVersion(productionVersion);
  if (production) segments.push(production);
  return segments;
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
