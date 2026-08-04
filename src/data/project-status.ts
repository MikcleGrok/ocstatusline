import { readFileSync, statSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const STATUS_FILE = '.status/state.json';

export interface ProjectStatus {
  productionVersion: string | null;
  root: string | null;
}

const EMPTY_STATUS: ProjectStatus = { productionVersion: null, root: null };
const statusCache = new Map<string, ProjectStatus>();

function safeVersion(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const version = value.trim();
  return version && !/[\u0000-\u001f\u007f-\u009f]/u.test(version) ? version : null;
}

function parseStatus(raw: string, root: string): ProjectStatus {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...EMPTY_STATUS, root };
    const production = (value as { production?: unknown }).production;
    if (!production || typeof production !== 'object' || Array.isArray(production)) return { ...EMPTY_STATUS, root };
    const version = (production as { version?: unknown }).version;
    return { productionVersion: safeVersion(version), root };
  } catch {
    return { ...EMPTY_STATUS, root };
  }
}

function parentDirectory(directory: string): string | null {
  const parent = dirname(directory);
  return parent === directory ? null : parent;
}

function findStatusRootSync(cwd: string): string | null {
  let directory: string | null = resolve(cwd);
  while (directory) {
    try {
      if (statSync(join(directory, STATUS_FILE)).isFile()) return directory;
    } catch { /* keep walking; missing or unreadable status is not fatal */ }
    directory = parentDirectory(directory);
  }
  return null;
}

async function findStatusRoot(cwd: string): Promise<string | null> {
  let directory: string | null = resolve(cwd);
  while (directory) {
    try {
      if ((await stat(join(directory, STATUS_FILE))).isFile()) return directory;
    } catch { /* keep walking; missing or unreadable status is not fatal */ }
    directory = parentDirectory(directory);
  }
  return null;
}

export function readProjectStatusSync(cwd: string | null): ProjectStatus {
  if (!cwd) return EMPTY_STATUS;
  const root = findStatusRootSync(cwd);
  if (!root) return EMPTY_STATUS;
  try { return parseStatus(readFileSync(join(root, STATUS_FILE), 'utf8'), root); }
  catch { return { ...EMPTY_STATUS, root }; }
}

export function readProjectStatusCachedSync(cwd: string | null): ProjectStatus {
  if (!cwd) return EMPTY_STATUS;
  const key = resolve(cwd);
  const cached = statusCache.get(key);
  if (cached) return cached;
  const status = readProjectStatusSync(key);
  statusCache.set(key, status);
  return status;
}

export async function readProjectStatus(cwd: string | null): Promise<ProjectStatus> {
  if (!cwd) return EMPTY_STATUS;
  const root = await findStatusRoot(cwd);
  if (!root) {
    const status = { ...EMPTY_STATUS, root: null };
    statusCache.set(resolve(cwd), status);
    return status;
  }
  try {
    const status = parseStatus(await readFile(join(root, STATUS_FILE), 'utf8'), root);
    statusCache.set(resolve(cwd), status);
    return status;
  } catch {
    const status = { ...EMPTY_STATUS, root };
    statusCache.set(resolve(cwd), status);
    return status;
  }
}
