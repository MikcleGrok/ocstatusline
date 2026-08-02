import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { OpenRouterBalance } from '../tui/openrouter.js';
import type { OpenRouterWeeklyContext } from '../types/index.js';

export interface WeeklyAnchor { windowStartMs: number; accountBalanceAtStartUsd: number; }
export type WeeklyBalanceSeverity = 'critical' | 'warning' | 'normal';
export function weeklyStatePath(): string { return join(homedir(), '.config', 'ocstatusline', 'openrouter-weekly-window.json'); }

export function weeklyBalanceSeverity(state: Pick<OpenRouterWeeklyContext, 'source' | 'budgetUsd' | 'remainingUsd'>): WeeklyBalanceSeverity {
  if (state.source !== 'account') return 'normal';
  const remainingPct = state.budgetUsd > 0 ? state.remainingUsd / state.budgetUsd : 1;
  return remainingPct < 0.1 ? 'critical' : remainingPct < 0.25 ? 'warning' : 'normal';
}

export function mondayStartMs(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return date.getTime();
}

export function updateWeeklyState(balance: OpenRouterBalance | null, budgetUsd: number, now: number, previous: OpenRouterWeeklyContext | null = null, statePath = weeklyStatePath()): OpenRouterWeeklyContext {
  const windowStartMs = mondayStartMs(now);
  const windowEndMs = mondayStartMs(now + 8 * 24 * 60 * 60 * 1000);
  const currentWindowPrevious = previous?.windowStartMs === windowStartMs ? previous : null;
  let anchor: WeeklyAnchor | null = null;
  try { anchor = JSON.parse(readFileSync(statePath, 'utf8')); } catch { /* first run or unavailable state */ }
  if (anchor?.windowStartMs !== windowStartMs) anchor = null;
  if (balance?.source === 'account' && !anchor) {
    anchor = { windowStartMs, accountBalanceAtStartUsd: balance.balanceUsd };
    try { mkdirSync(dirname(statePath), { recursive: true }); writeFileSync(statePath, JSON.stringify(anchor), 'utf8'); } catch { /* keep runtime state in memory */ }
  }
  if ((!balance || balance.source === 'key-limit') && currentWindowPrevious?.source === 'account') return { ...currentWindowPrevious, budgetUsd, windowEndMs };
  if (!balance && currentWindowPrevious) return { ...currentWindowPrevious, budgetUsd, windowEndMs };
  const source = balance?.source ?? currentWindowPrevious?.source ?? null;
  const balanceUsd = balance?.balanceUsd ?? currentWindowPrevious?.balanceUsd ?? null;
  const spentUsd = source === 'account' && anchor && balanceUsd !== null ? Math.max(0, anchor.accountBalanceAtStartUsd - balanceUsd) : 0;
  return { source, balanceUsd, budgetUsd, spentUsd, remainingUsd: Math.max(0, Math.min(budgetUsd, budgetUsd - spentUsd)), windowStartMs, windowEndMs };
}
