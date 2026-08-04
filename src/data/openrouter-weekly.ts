import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { OpenRouterBalance } from '../tui/openrouter.js';
import type { OpenRouterWeeklyContext } from '../types/index.js';

export interface WeeklyAnchor { windowStartMs: number; accountBalanceAtStartUsd: number; }
export type WeeklyBalanceSeverity = 'sky-blue' | 'teal' | 'muted-green' | 'orange' | 'dark-red' | 'neutral';
export function weeklyStatePath(): string { return join(homedir(), '.config', 'ocstatusline', 'openrouter-weekly-window.json'); }

export function weeklyBalanceSeverity(state: Pick<OpenRouterWeeklyContext, 'source' | 'budgetUsd' | 'remainingUsd'> & Partial<Pick<OpenRouterWeeklyContext, 'spentUsd' | 'windowStartMs' | 'windowEndMs'>>, nowMs?: number): WeeklyBalanceSeverity {
  if (state.source !== 'account') return 'neutral';
  const { spentUsd, windowStartMs, windowEndMs } = state;
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs) || typeof spentUsd !== 'number' || !Number.isFinite(spentUsd) || !Number.isFinite(state.budgetUsd) || state.budgetUsd <= 0 || typeof windowStartMs !== 'number' || !Number.isFinite(windowStartMs) || typeof windowEndMs !== 'number' || !Number.isFinite(windowEndMs) || windowEndMs <= windowStartMs || spentUsd < 0) {
    return 'neutral';
  }
  const windowDurationMs = windowEndMs - windowStartMs;
  const elapsedMs = Math.min(windowDurationMs, Math.max(0, nowMs - windowStartMs));
  const usedPct = spentUsd / state.budgetUsd * 100;
  if (elapsedMs === 0) return spentUsd === 0 ? 'sky-blue' : usedPct < 15 ? 'orange' : 'dark-red';
  const elapsedPct = elapsedMs / windowDurationMs * 100;
  const burnRatio = usedPct / elapsedPct;
  if (burnRatio <= 0.4 + 1e-9) return 'sky-blue';
  if (burnRatio <= 0.6667 + 1e-9) return 'teal';
  if (burnRatio <= 1) return 'muted-green';
  return usedPct - elapsedPct < 15 ? 'orange' : 'dark-red';
}

export function accountBalanceSeverity(state: Pick<OpenRouterWeeklyContext, 'source' | 'budgetUsd' | 'balanceUsd'>): WeeklyBalanceSeverity {
  if (state.source !== 'account' || state.balanceUsd === null || !Number.isFinite(state.balanceUsd) || !Number.isFinite(state.budgetUsd) || state.budgetUsd <= 0) return 'neutral';
  return balanceColorLevel(state.balanceUsd, state.budgetUsd);
}

function balanceColorLevel(balanceUsd: number, budgetUsd: number): Exclude<WeeklyBalanceSeverity, 'neutral'> {
  const remainingPct = budgetUsd > 0 ? balanceUsd / budgetUsd : 1;
  return remainingPct < 0.1 ? 'dark-red' : remainingPct < 0.25 ? 'orange' : remainingPct < 0.5 ? 'muted-green' : remainingPct < 0.75 ? 'teal' : 'sky-blue';
}

export function mondayStartMs(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return date.getTime();
}

export function updateWeeklyState(balance: OpenRouterBalance | null, budgetUsd: number, now: number, previous: OpenRouterWeeklyContext | null = null, statePath = weeklyStatePath()): OpenRouterWeeklyContext {
  const validBudget = Number.isFinite(budgetUsd) && budgetUsd > 0 ? budgetUsd : 0;
  if (!Number.isFinite(now) || validBudget === 0) return { source: null, balanceUsd: null, budgetUsd: validBudget, spentUsd: 0, remainingUsd: 0, windowStartMs: 0, windowEndMs: 0 };
  const validBalance = balance && Number.isFinite(balance.balanceUsd) ? balance : null;
  const windowStartMs = mondayStartMs(now);
  const windowEndMs = mondayStartMs(now + 8 * 24 * 60 * 60 * 1000);
  const currentWindowPrevious = previous?.windowStartMs === windowStartMs ? previous : null;
  let anchor: WeeklyAnchor | null = null;
  try { anchor = JSON.parse(readFileSync(statePath, 'utf8')); } catch { /* first run or unavailable state */ }
  if (anchor && (anchor.windowStartMs !== windowStartMs || !Number.isFinite(anchor.accountBalanceAtStartUsd))) anchor = null;
  if (validBalance?.source === 'account' && !anchor) {
    anchor = { windowStartMs, accountBalanceAtStartUsd: validBalance.balanceUsd };
    try { mkdirSync(dirname(statePath), { recursive: true }); writeFileSync(statePath, JSON.stringify(anchor), 'utf8'); } catch { /* keep runtime state in memory */ }
  }
  if ((!validBalance || validBalance.source === 'key-limit') && currentWindowPrevious?.source === 'account') return { ...currentWindowPrevious, budgetUsd: validBudget, windowEndMs };
  if (!validBalance && currentWindowPrevious) return { ...currentWindowPrevious, budgetUsd: validBudget, windowEndMs };
  const source = validBalance?.source ?? currentWindowPrevious?.source ?? null;
  const balanceUsd = validBalance?.balanceUsd ?? currentWindowPrevious?.balanceUsd ?? null;
  const spentUsd = source === 'account' && anchor && balanceUsd !== null ? Math.max(0, anchor.accountBalanceAtStartUsd - balanceUsd) : 0;
  const remainingUsd = Math.max(0, Math.min(validBudget, validBudget - spentUsd));
  return { source, balanceUsd, budgetUsd: validBudget, spentUsd, remainingUsd, windowStartMs, windowEndMs };
}
