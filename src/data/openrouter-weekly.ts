import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { OpenRouterBalance, OpenRouterWeeklyContext } from '../types/index.js';

export interface WeeklyAnchor { version: 2; windowStartMs: number; usageAtStart: number; lastUsage: number; }
interface LegacyWeeklyAnchor { windowStartMs: number; accountBalanceAtStartUsd: number; pendingUsageRebase?: boolean; }
interface WeeklyRecord { version: 1; windowStartMs: number; usageAtStart?: number; observedUsage?: number; legacyBalanceAtStartUsd?: number; pendingUsageRebase?: boolean; writerId?: string; }
const writerId = `${process.pid}-${randomUUID()}`;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
export type WeeklyBalanceSeverity = 'sky-blue' | 'teal' | 'muted-green' | 'orange' | 'dark-red' | 'over-budget' | 'neutral';
export function weeklyStatePath(): string { return join(homedir(), '.config', 'ocstatusline', 'openrouter-weekly-window.json'); }

export function mergeWeeklyUsageState(previous: WeeklyAnchor | null, usageAtStart: number, observedUsage: number): WeeklyAnchor {
  return { version: 2, windowStartMs: previous?.windowStartMs ?? 0, usageAtStart: previous?.usageAtStart ?? usageAtStart, lastUsage: Math.max(previous?.lastUsage ?? observedUsage, observedUsage) };
}

function writeWeeklyState(statePath: string, value: WeeklyAnchor | LegacyWeeklyAnchor): void {
  mkdirSync(dirname(statePath), { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  const temporaryPath = `${statePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(value), { encoding: 'utf8', mode: PRIVATE_FILE_MODE });
  renameSync(temporaryPath, statePath);
}

function recordsPath(statePath: string): string { return `${statePath}.records`; }

function validWeeklyRecord(record: Partial<WeeklyRecord>, windowStartMs: number): record is WeeklyRecord {
  if (record.version !== 1 || record.windowStartMs !== windowStartMs) return false;
  if (record.usageAtStart !== undefined && (typeof record.usageAtStart !== 'number' || !Number.isFinite(record.usageAtStart) || record.usageAtStart < 0)) return false;
  if (record.observedUsage !== undefined && (typeof record.observedUsage !== 'number' || !Number.isFinite(record.observedUsage) || record.observedUsage < 0)) return false;
  if (record.usageAtStart !== undefined && record.observedUsage !== undefined && record.observedUsage < record.usageAtStart) return false;
  if (record.legacyBalanceAtStartUsd !== undefined && (typeof record.legacyBalanceAtStartUsd !== 'number' || !Number.isFinite(record.legacyBalanceAtStartUsd) || record.legacyBalanceAtStartUsd < 0)) return false;
  return true;
}

function readWeeklyRecords(statePath: string, windowStartMs: number): WeeklyRecord[] {
  try {
    return readdirSync(recordsPath(statePath)).flatMap((name) => {
      try {
        const record = JSON.parse(readFileSync(join(recordsPath(statePath), name), 'utf8')) as Partial<WeeklyRecord>;
        return validWeeklyRecord(record, windowStartMs) ? [{ ...record, writerId: record.writerId ?? (name.endsWith(`-${windowStartMs}.json`) ? name.slice(0, -`${windowStartMs}.json`.length) : undefined) }] : [];
      } catch { return []; }
    });
  } catch { return []; }
}

function publishWeeklyRecord(statePath: string, record: WeeklyRecord): void {
  const directory = recordsPath(statePath);
  mkdirSync(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  const temporaryPath = join(directory, `.${writerId}-${record.windowStartMs}.tmp`);
  const recordPath = join(directory, `${writerId}-${record.windowStartMs}.json`);
  writeFileSync(temporaryPath, JSON.stringify(record), { encoding: 'utf8', mode: PRIVATE_FILE_MODE });
  renameSync(temporaryPath, recordPath);
}

type ProcessStartSignatureSource = 'ps' | 'proc';
interface ProcessStartIdentity { source: ProcessStartSignatureSource; signature: string; }
interface WeeklyLockMetadata { version: 1; pid: number; token: string; startSignature: string; startSignatureSource: ProcessStartSignatureSource; }

const WEEKLY_LOCK_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const WEEKLY_LOCK_WAIT_TIMEOUT_MS = 5_000;
const PROCESS_START_IDENTITY_TIMEOUT_MS = 250; // Bound ps so lock recovery cannot block on a wedged process table.
const weeklyProcessStartIdentity = processStartIdentity(process.pid);
// These hooks are only enabled by the multi-process test; normal callers never change lock timing.
const testLockHeldPath = process.env.OCSTATUSLINE_WEEKLY_TEST_LOCK_HELD_PATH;
const testLockObservedPath = process.env.OCSTATUSLINE_WEEKLY_TEST_LOCK_OBSERVED_PATH;
const testLockReleasePath = process.env.OCSTATUSLINE_WEEKLY_TEST_LOCK_RELEASE_PATH;

function testLockHookPath(path: string | undefined, lockPath: string): void {
  if (!path) return;
  try { writeFileSync(path, JSON.stringify({ pid: process.pid, lockPath }), 'utf8'); } catch { /* Test-only observation must not alter lock semantics. */ }
}

function holdLockForTest(lockPath: string): void {
  if (!testLockHeldPath || !testLockReleasePath) return;
  testLockHookPath(testLockHeldPath, lockPath);
  const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + WEEKLY_LOCK_WAIT_TIMEOUT_MS;
  while (!existsSync(testLockReleasePath) && Date.now() < deadline) Atomics.wait(waitBuffer, 0, 0, 1);
  if (!existsSync(testLockReleasePath)) throw new Error(`weekly test lock hold timeout: ${lockPath}`);
}

function readWeeklyLockMetadata(metadataPath: string): WeeklyLockMetadata | null {
  try {
    const value = JSON.parse(readFileSync(metadataPath, 'utf8')) as Partial<WeeklyLockMetadata>;
    const pid = value.pid;
    const token = value.token;
    const startSignature = value.startSignature;
    const startSignatureSource = value.startSignatureSource;
    return value.version === 1 && typeof pid === 'number' && Number.isInteger(pid) && pid > 0 && typeof token === 'string' && WEEKLY_LOCK_TOKEN.test(token) && typeof startSignature === 'string' && startSignature.length > 0 && (startSignatureSource === 'ps' || startSignatureSource === 'proc') ? { version: 1, pid, token, startSignature, startSignatureSource } : null;
  } catch {
    return null;
  }
}

interface WeeklyLockObservation { metadata: WeeklyLockMetadata; released: boolean; }

function observeWeeklyLock(lockPath: string): WeeklyLockObservation | null {
  try {
    const names = readdirSync(lockPath).filter((name) => name.startsWith('owner-') || name.startsWith('released-'));
    if (names.length !== 1) return null;
    const name = names[0];
    const released = name.startsWith('released-');
    const token = name.slice(released ? 'released-'.length : 'owner-'.length, -'.json'.length);
    if (!WEEKLY_LOCK_TOKEN.test(token) || name !== `${released ? 'released' : 'owner'}-${token}.json`) return null;
    const metadata = readWeeklyLockMetadata(join(lockPath, name));
    return metadata && metadata.token === token ? { metadata, released } : null;
  } catch {
    return null;
  }
}

function processStartIdentity(pid: number): ProcessStartIdentity | null {
  try {
    const value = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', timeout: PROCESS_START_IDENTITY_TIMEOUT_MS, env: { ...process.env, LC_ALL: 'C', LANG: 'C' }, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return value.length > 0 ? { source: 'ps', signature: value } : null;
  } catch {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const commandEnd = stat.lastIndexOf(')');
      const fields = commandEnd >= 0 ? stat.slice(commandEnd + 2).trim().split(/\s+/) : [];
      return fields.length > 19 && fields[19].length > 0 ? { source: 'proc', signature: fields[19] } : null;
    } catch {
      return null;
    }
  }
}

function syncFile(path: string): void {
  const fd = openSync(path, 'r');
  try {
    try { fsyncSync(fd); } catch { /* Some filesystems do not support fsync for this file. */ }
  } finally {
    closeSync(fd);
  }
}

function lockArtifactPath(lockPath: string, kind: 'candidate' | 'released', token: string): string | null {
  return WEEKLY_LOCK_TOKEN.test(token) ? `${lockPath}.${kind}-${token}` : null;
}

function cleanupLockArtifact(directory: string, token: string): boolean {
  if (!WEEKLY_LOCK_TOKEN.test(token)) return false;
  const ownerPath = join(directory, `owner-${token}.json`);
  const owner = readWeeklyLockMetadata(ownerPath);
  if (!owner || owner.token !== token || ownerState(owner) !== 'stale') return false;
  try {
    unlinkSync(ownerPath);
    rmdirSync(directory);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    return false;
  }
}

function cleanupEmptyReleasedLockArtifact(directory: string, lockPath: string, token: string): boolean {
  if (!WEEKLY_LOCK_TOKEN.test(token) || basename(directory) !== `${basename(lockPath)}.released-${token}`) return false;
  try {
    if (readdirSync(directory).length !== 0) return false;
    rmdirSync(directory);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }
}

function cleanupReleasedLockArtifactIfOwned(directory: string, owner: WeeklyLockMetadata): boolean {
  const token = owner.token;
  if (!WEEKLY_LOCK_TOKEN.test(token) || weeklyProcessStartIdentity === null) return false;
  const ownerPath = join(directory, `owner-${token}.json`);
  const released = readWeeklyLockMetadata(ownerPath);
  if (!released || released.token !== token || released.pid !== owner.pid || released.startSignatureSource !== owner.startSignatureSource || released.startSignature !== owner.startSignature || owner.pid !== process.pid || owner.startSignatureSource !== weeklyProcessStartIdentity.source || owner.startSignature !== weeklyProcessStartIdentity.signature) return false;
  try {
    unlinkSync(ownerPath);
    rmdirSync(directory);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    return false;
  }
}

function recoverLockArtifacts(lockPath: string): void {
  const parent = dirname(lockPath);
  const prefix = `${basename(lockPath)}.`;
  try {
    for (const name of readdirSync(parent)) {
      if (!name.startsWith(prefix)) continue;
      const match = /\.(candidate|released)-([0-9a-f-]+)$/i.exec(name);
      if (!match || !WEEKLY_LOCK_TOKEN.test(match[2])) continue;
      const artifactPath = join(parent, name);
      cleanupLockArtifact(artifactPath, match[2]);
      if (match[1].toLowerCase() === 'released') cleanupEmptyReleasedLockArtifact(artifactPath, lockPath, match[2]);
    }
  } catch { /* Keep the lock fail-closed when artifact enumeration is unavailable. */ }
}

function ownerState(owner: WeeklyLockMetadata): 'live' | 'stale' | 'ambiguous' {
  const identity = processStartIdentity(owner.pid);
  if (identity !== null) {
    if (identity.source !== owner.startSignatureSource) return 'ambiguous';
    return identity.signature === owner.startSignature ? 'live' : 'stale';
  }
  try {
    process.kill(owner.pid, 0);
    return 'ambiguous';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'stale' : 'ambiguous';
  }
}

function removeWeeklyLockIfOwned(lockPath: string, token: string): void {
  if (!WEEKLY_LOCK_TOKEN.test(token)) return;
  try {
    const ownerPath = join(lockPath, `owner-${token}.json`);
    const releasedPath = lockArtifactPath(lockPath, 'released', token);
    const owner = readWeeklyLockMetadata(ownerPath);
    if (!releasedPath || !owner || owner.token !== token || owner.pid !== process.pid || weeklyProcessStartIdentity === null || owner.startSignatureSource !== weeklyProcessStartIdentity.source || owner.startSignature !== weeklyProcessStartIdentity.signature) return;
    renameSync(lockPath, releasedPath);
    cleanupReleasedLockArtifactIfOwned(releasedPath, owner);
  } catch {
    /* A replacement or an ambiguous lock must remain untouched. */
  }
}

function recoverWeeklyLock(lockPath: string, observation: WeeklyLockObservation | null): boolean {
  if (!observation || (!observation.released && ownerState(observation.metadata) !== 'stale')) return false;
  try {
    if (!WEEKLY_LOCK_TOKEN.test(observation.metadata.token)) return false;
    const ownerPath = join(lockPath, `${observation.released ? 'released' : 'owner'}-${observation.metadata.token}.json`);
    const current = readWeeklyLockMetadata(ownerPath);
    if (!current || current.token !== observation.metadata.token || current.startSignatureSource !== observation.metadata.startSignatureSource || current.startSignature !== observation.metadata.startSignature) return false;
    if (observation.released) return cleanupLockArtifact(lockPath, observation.metadata.token);
    const releasedPath = lockArtifactPath(lockPath, 'released', observation.metadata.token);
    if (!releasedPath) return false;
    renameSync(lockPath, releasedPath);
    cleanupLockArtifact(releasedPath, observation.metadata.token);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    if ((error as NodeJS.ErrnoException).code === 'ENOTEMPTY' || (error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

function acquireWeeklyStateLock(statePath: string): () => void {
  const lockPath = `${statePath}.lock`;
  const token = randomUUID();
  if (weeklyProcessStartIdentity === null) throw new Error('weekly state lock unavailable: cannot determine process start signature');
  const owner = { version: 1 as const, pid: process.pid, token, startSignature: weeklyProcessStartIdentity.signature, startSignatureSource: weeklyProcessStartIdentity.source };
  const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + WEEKLY_LOCK_WAIT_TIMEOUT_MS;
  try {
    for (;;) {
      try {
        recoverLockArtifacts(lockPath);
        if (existsSync(lockPath)) {
          if (recoverWeeklyLock(lockPath, observeWeeklyLock(lockPath))) continue;
          testLockHookPath(testLockObservedPath, lockPath);
          if (Date.now() >= deadline) throw new Error(`weekly state lock timeout: ${lockPath}`);
          Atomics.wait(waitBuffer, 0, 0, 1);
          continue;
        }
        const candidatePath = lockArtifactPath(lockPath, 'candidate', token);
        if (!candidatePath) throw new Error('weekly state lock unavailable: invalid token');
        mkdirSync(candidatePath, { mode: PRIVATE_DIRECTORY_MODE });
        const ownerPath = join(candidatePath, `owner-${token}.json`);
        writeFileSync(ownerPath, JSON.stringify(owner), { encoding: 'utf8', mode: PRIVATE_FILE_MODE });
        syncFile(ownerPath);
        renameSync(candidatePath, lockPath);
        holdLockForTest(lockPath);
        return () => removeWeeklyLockIfOwned(lockPath, token);
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) {
          throw error;
        }
        if (recoverWeeklyLock(lockPath, observeWeeklyLock(lockPath))) continue;
        testLockHookPath(testLockObservedPath, lockPath);
        if (Date.now() >= deadline) throw new Error(`weekly state lock timeout: ${lockPath}`);
        Atomics.wait(waitBuffer, 0, 0, 1);
      }
    }
  } catch (error) {
    throw error;
  }
}

export function weeklyBalanceSeverity(state: Pick<OpenRouterWeeklyContext, 'source' | 'budgetUsd' | 'remainingUsd'> & Partial<Pick<OpenRouterWeeklyContext, 'spentUsd' | 'windowStartMs' | 'windowEndMs'>>, nowMs?: number): WeeklyBalanceSeverity {
  if (state.source !== 'account') return 'neutral';
  const { spentUsd, windowStartMs, windowEndMs } = state;
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs) || typeof spentUsd !== 'number' || !Number.isFinite(spentUsd) || !Number.isFinite(state.budgetUsd) || state.budgetUsd <= 0 || typeof windowStartMs !== 'number' || !Number.isFinite(windowStartMs) || typeof windowEndMs !== 'number' || !Number.isFinite(windowEndMs) || windowEndMs <= windowStartMs || spentUsd < 0) {
    return 'neutral';
  }
  const windowDurationMs = windowEndMs - windowStartMs;
  const elapsedMs = Math.min(windowDurationMs, Math.max(0, nowMs - windowStartMs));
  if (spentUsd > state.budgetUsd) return 'over-budget';
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

function validWeeklyAnchorState(value: Partial<WeeklyAnchor> | null | undefined, windowStartMs: number): value is WeeklyAnchor {
  return value?.version === 2 && value.windowStartMs === windowStartMs && typeof value.usageAtStart === 'number' && Number.isFinite(value.usageAtStart) && value.usageAtStart >= 0 && typeof value.lastUsage === 'number' && Number.isFinite(value.lastUsage) && value.lastUsage >= value.usageAtStart;
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
  mkdirSync(dirname(statePath), { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  const releaseLock = acquireWeeklyStateLock(statePath);
  try {
  {
    const windowStartMs = mondayStartMs(now);
    const windowEndMs = mondayStartMs(now + 8 * 24 * 60 * 60 * 1000);
    const currentWindowPrevious = previous?.windowStartMs === windowStartMs ? previous : null;
    const records = readWeeklyRecords(statePath, windowStartMs);
    const recordLastUsage = records.flatMap((record) => typeof record.observedUsage === 'number' && Number.isFinite(record.observedUsage) && record.observedUsage >= 0 ? [record.observedUsage] : []);
    const recordLegacyBalances = records.flatMap((record) => typeof record.legacyBalanceAtStartUsd === 'number' && Number.isFinite(record.legacyBalanceAtStartUsd) ? [record.legacyBalanceAtStartUsd] : []);
    let persisted: WeeklyAnchor | null = null;
    let legacyAnchor: LegacyWeeklyAnchor | null = null;
    try {
      const saved = JSON.parse(readFileSync(statePath, 'utf8')) as Partial<WeeklyAnchor & LegacyWeeklyAnchor>;
      if (validWeeklyAnchorState(saved, windowStartMs)) persisted = saved;
      if (saved.version !== 2 && saved.windowStartMs === windowStartMs && typeof saved.accountBalanceAtStartUsd === 'number' && Number.isFinite(saved.accountBalanceAtStartUsd) && saved.accountBalanceAtStartUsd >= 0) legacyAnchor = saved as LegacyWeeklyAnchor;
    } catch { /* first run or unavailable state */ }
    const previousUsageState = validWeeklyAnchorState({ version: 2, ...currentWindowPrevious }, windowStartMs);
    const independentRecordUsageAtStart = records.filter((record) => record.writerId !== writerId).flatMap((record) => typeof record.usageAtStart === 'number' && Number.isFinite(record.usageAtStart) && record.usageAtStart >= 0 ? [record.usageAtStart] : []);
    const currentWriterRecord = records.find((record) => record.writerId === writerId && typeof record.usageAtStart === 'number' && Number.isFinite(record.usageAtStart) && record.usageAtStart >= 0);
    const usageAnchors = [persisted?.usageAtStart, previousUsageState ? currentWindowPrevious?.usageAtStart : undefined, ...independentRecordUsageAtStart, currentWriterRecord?.usageAtStart].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    let usageAtStart = usageAnchors.length > 0 ? Math.min(...usageAnchors) : null;
    let lastUsage = recordLastUsage.length > 0 ? Math.max(...recordLastUsage) : persisted?.lastUsage ?? (previousUsageState ? currentWindowPrevious?.lastUsage ?? null : null);
    if (usageAtStart !== null && lastUsage !== null) lastUsage = Math.max(lastUsage, usageAtStart);
    if (validUsage !== null && lastUsage !== null) lastUsage = Math.max(lastUsage, validUsage);
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
        const balanceDerivedOffset = Math.max(0, legacyAnchor.accountBalanceAtStartUsd - validBalance.balanceUsd);
        if (validUsage >= balanceDerivedOffset) {
          usageAtStart = validUsage - balanceDerivedOffset;
          lastUsage = validUsage;
          legacyAnchor = null;
        }
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
      const writerHighWater = currentWriterRecord?.observedUsage !== undefined && Number.isFinite(currentWriterRecord.observedUsage) && currentWriterRecord.observedUsage >= 0 ? currentWriterRecord.observedUsage : 0;
      try { publishWeeklyRecord(statePath, { version: 1, windowStartMs, usageAtStart, observedUsage: Math.max(validUsage, writerHighWater), writerId }); } catch { /* keep runtime state in memory */ }
      const concurrentRecords = readWeeklyRecords(statePath, windowStartMs);
      const concurrentUsageAtStart = concurrentRecords.filter((record) => record.writerId !== writerId).flatMap((record) => typeof record.usageAtStart === 'number' && Number.isFinite(record.usageAtStart) ? [record.usageAtStart] : []);
      const concurrentLastUsage = concurrentRecords.flatMap((record) => typeof record.observedUsage === 'number' && Number.isFinite(record.observedUsage) && record.observedUsage >= 0 ? [record.observedUsage] : []);
      if (concurrentUsageAtStart.length > 0) usageAtStart = Math.min(usageAtStart, ...concurrentUsageAtStart);
      if (concurrentLastUsage.length > 0) lastUsage = Math.max(lastUsage, ...concurrentLastUsage);
      merged.usageAtStart = usageAtStart;
      merged.lastUsage = lastUsage;
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
  } finally {
    releaseLock();
  }
}
