import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { OpenRouterBalance } from '../tui/openrouter.js';
import type { OpenRouterWeeklyContext } from '../types/index.js';

export interface WeeklyAnchor { version: 2; windowStartMs: number; usageAtStart: number; lastUsage: number; }
interface LegacyWeeklyAnchor { windowStartMs: number; accountBalanceAtStartUsd: number; pendingUsageRebase?: boolean; }
interface WeeklyRecord { version: 1; windowStartMs: number; usageAtStart?: number; observedUsage?: number; legacyBalanceAtStartUsd?: number; pendingUsageRebase?: boolean; }
const writerId = `${process.pid}-${randomUUID()}`;
export type WeeklyBalanceSeverity = 'sky-blue' | 'teal' | 'muted-green' | 'orange' | 'dark-red' | 'neutral';
export function weeklyStatePath(): string { return join(homedir(), '.config', 'ocstatusline', 'openrouter-weekly-window.json'); }

export function mergeWeeklyUsageState(previous: WeeklyAnchor | null, usageAtStart: number, observedUsage: number): WeeklyAnchor {
  return { version: 2, windowStartMs: previous?.windowStartMs ?? 0, usageAtStart: previous?.usageAtStart ?? usageAtStart, lastUsage: Math.max(previous?.lastUsage ?? observedUsage, observedUsage) };
}

function writeWeeklyState(statePath: string, value: WeeklyAnchor | LegacyWeeklyAnchor): void {
  mkdirSync(dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(value), 'utf8');
  renameSync(temporaryPath, statePath);
}

function recordsPath(statePath: string): string { return `${statePath}.records`; }

function readWeeklyRecords(statePath: string, windowStartMs: number): WeeklyRecord[] {
  try {
    return readdirSync(recordsPath(statePath)).flatMap((name) => {
      try {
        const record = JSON.parse(readFileSync(join(recordsPath(statePath), name), 'utf8')) as Partial<WeeklyRecord>;
        return record.version === 1 && record.windowStartMs === windowStartMs ? [record as WeeklyRecord] : [];
      } catch { return []; }
    });
  } catch { return []; }
}

function publishWeeklyRecord(statePath: string, record: WeeklyRecord): void {
  const directory = recordsPath(statePath);
  mkdirSync(directory, { recursive: true });
  const temporaryPath = join(directory, `.${writerId}-${record.windowStartMs}.tmp`);
  const recordPath = join(directory, `${writerId}-${record.windowStartMs}.json`);
  writeFileSync(temporaryPath, JSON.stringify(record), 'utf8');
  renameSync(temporaryPath, recordPath);
}

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

export function updateWeeklyState(balance: OpenRouterBalance | null, budgetUsd: number, now: number, previous?: OpenRouterWeeklyContext | null, statePath?: string): OpenRouterWeeklyContext;
export function updateWeeklyState(balance: OpenRouterBalance | null, usage: number | null, budgetUsd: number, now: number, previous?: OpenRouterWeeklyContext | null, statePath?: string): OpenRouterWeeklyContext;
export function updateWeeklyState(balance: OpenRouterBalance | null, usageOrBudget: number | null, budgetOrNow: number, nowOrPrevious?: number | OpenRouterWeeklyContext | null, previousOrPath: OpenRouterWeeklyContext | string | null = null, maybeStatePath = weeklyStatePath()): OpenRouterWeeklyContext {
  const usageMode = typeof nowOrPrevious === 'number';
  const usage = usageMode ? usageOrBudget : null;
  const budgetUsd = usageMode ? budgetOrNow : usageOrBudget as number;
  const now = usageMode ? nowOrPrevious : budgetOrNow;
  const previous = (usageMode ? previousOrPath : nowOrPrevious) as OpenRouterWeeklyContext | null | undefined;
  const statePath = ((usageMode ? maybeStatePath : previousOrPath) as string | undefined) ?? weeklyStatePath();
  const validBudget = Number.isFinite(budgetUsd) && budgetUsd > 0 ? budgetUsd : 0;
  if (!Number.isFinite(now) || validBudget === 0) return { source: null, balanceUsd: null, budgetUsd: validBudget, spentUsd: 0, remainingUsd: 0, windowStartMs: 0, windowEndMs: 0 };
  const validBalance = balance && Number.isFinite(balance.balanceUsd) ? balance : null;
  const validUsage = typeof usage === 'number' && Number.isFinite(usage) && usage >= 0 ? usage : null;
  {
    const windowStartMs = mondayStartMs(now);
    const windowEndMs = mondayStartMs(now + 8 * 24 * 60 * 60 * 1000);
    const currentWindowPrevious = previous?.windowStartMs === windowStartMs ? previous : null;
    const records = readWeeklyRecords(statePath, windowStartMs);
    const recordUsageAtStart = records.flatMap((record) => typeof record.usageAtStart === 'number' && Number.isFinite(record.usageAtStart) ? [record.usageAtStart] : []);
    const recordLastUsage = records.flatMap((record) => typeof record.observedUsage === 'number' && Number.isFinite(record.observedUsage) ? [record.observedUsage] : []);
    const recordLegacyBalances = records.flatMap((record) => typeof record.legacyBalanceAtStartUsd === 'number' && Number.isFinite(record.legacyBalanceAtStartUsd) ? [record.legacyBalanceAtStartUsd] : []);
    let persisted: WeeklyAnchor | null = null;
    let legacyAnchor: LegacyWeeklyAnchor | null = null;
    try {
      const saved = JSON.parse(readFileSync(statePath, 'utf8')) as Partial<WeeklyAnchor & LegacyWeeklyAnchor>;
      if (saved.version === 2 && saved.windowStartMs === windowStartMs && Number.isFinite(saved.usageAtStart) && Number.isFinite(saved.lastUsage)) persisted = saved as WeeklyAnchor;
      if (saved.version !== 2 && saved.windowStartMs === windowStartMs && Number.isFinite(saved.accountBalanceAtStartUsd)) legacyAnchor = saved as LegacyWeeklyAnchor;
    } catch { /* first run or unavailable state */ }
    const previousUsageState = currentWindowPrevious?.usageAtStart !== undefined && currentWindowPrevious.lastUsage !== undefined;
    let usageAtStart = recordUsageAtStart.length > 0 ? Math.min(...recordUsageAtStart) : persisted?.usageAtStart ?? (previousUsageState ? currentWindowPrevious?.usageAtStart ?? null : null);
    let lastUsage = recordLastUsage.length > 0 ? Math.max(...recordLastUsage) : persisted?.lastUsage ?? (previousUsageState ? currentWindowPrevious?.lastUsage ?? null : null);
    if (!persisted && recordLegacyBalances.length > 0) legacyAnchor = { windowStartMs, accountBalanceAtStartUsd: Math.max(legacyAnchor?.accountBalanceAtStartUsd ?? 0, ...recordLegacyBalances), pendingUsageRebase: Boolean(legacyAnchor?.pendingUsageRebase || records.some((record) => record.pendingUsageRebase)) };
    if (!persisted && legacyAnchor) {
      if (validBalance?.source === 'account' && validBalance.balanceUsd > legacyAnchor.accountBalanceAtStartUsd) {
        if (validUsage !== null && usageAtStart === null) {
          usageAtStart = validUsage;
          lastUsage = validUsage;
          legacyAnchor = null;
        } else {
          legacyAnchor = { windowStartMs, accountBalanceAtStartUsd: validBalance.balanceUsd, pendingUsageRebase: true };
        }
      } else if (validBalance?.source === 'account' && validUsage !== null && usageAtStart === null) {
        usageAtStart = validUsage - Math.max(0, legacyAnchor.accountBalanceAtStartUsd - validBalance.balanceUsd);
        lastUsage = validUsage;
        legacyAnchor = null;
      } else {
        legacyAnchor = { ...legacyAnchor, pendingUsageRebase: true };
      }
    }
    if (validUsage !== null && usageAtStart === null && !legacyAnchor) {
      usageAtStart = validUsage;
      lastUsage = validUsage;
    }
    if (validUsage !== null && usageAtStart !== null && lastUsage !== null) {
      const merged = mergeWeeklyUsageState({ version: 2, windowStartMs, usageAtStart, lastUsage }, usageAtStart, validUsage);
      merged.windowStartMs = windowStartMs;
      usageAtStart = merged.usageAtStart;
      lastUsage = merged.lastUsage;
      try { publishWeeklyRecord(statePath, { version: 1, windowStartMs, usageAtStart, observedUsage: validUsage }); } catch { /* keep runtime state in memory */ }
      try { writeWeeklyState(statePath, merged); } catch { /* keep runtime state in memory */ }
    }
    if (legacyAnchor && !persisted) {
      try { publishWeeklyRecord(statePath, { version: 1, windowStartMs, legacyBalanceAtStartUsd: legacyAnchor.accountBalanceAtStartUsd, pendingUsageRebase: legacyAnchor.pendingUsageRebase }); } catch { /* keep runtime state in memory */ }
      try { writeWeeklyState(statePath, legacyAnchor); } catch { /* keep runtime state in memory */ }
    }
    if (validUsage === null && validBalance?.source === 'account' && !legacyAnchor && !persisted) {
      legacyAnchor = { windowStartMs, accountBalanceAtStartUsd: validBalance.balanceUsd };
      try { publishWeeklyRecord(statePath, { version: 1, windowStartMs, legacyBalanceAtStartUsd: legacyAnchor.accountBalanceAtStartUsd }); } catch { /* keep runtime state in memory */ }
      try { writeWeeklyState(statePath, legacyAnchor); } catch { /* keep runtime state in memory */ }
    }
    const usageBased = usageAtStart !== null && lastUsage !== null;
    if (!usageBased && (!validBalance || validBalance.source === 'key-limit') && currentWindowPrevious?.source === 'account') return { ...currentWindowPrevious, budgetUsd: validBudget, windowEndMs };
    if (!usageBased && !validBalance && currentWindowPrevious) return { ...currentWindowPrevious, budgetUsd: validBudget, windowEndMs };
    const source = usageBased ? 'account' : validBalance?.source ?? currentWindowPrevious?.source ?? null;
    const balanceUsd = validBalance?.balanceUsd ?? currentWindowPrevious?.balanceUsd ?? null;
    const spentUsd = usageBased ? Math.max(0, (lastUsage as number) - (usageAtStart as number)) : source === 'account' && legacyAnchor && balanceUsd !== null ? Math.max(0, legacyAnchor.accountBalanceAtStartUsd - balanceUsd) : 0;
    const remainingUsd = Math.max(0, Math.min(validBudget, validBudget - spentUsd));
    return { source, balanceUsd, budgetUsd: validBudget, spentUsd, remainingUsd, windowStartMs, windowEndMs, ...(usageBased && usageAtStart !== null && lastUsage !== null ? { usageAtStart, lastUsage } : {}) };
  }
}
