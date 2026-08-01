import { basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseGit } from '../data/git.js';

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

export function formatTuiFooter(balance: number | null, git: TuiGitInfo): string {
  if (!git.isRepo || !git.root || !git.branch) return '';
  const balanceText = balance === null ? '?' : `$${balance.toFixed(2)}`;
  return `${balanceText} · ${basename(git.root)} · ${git.branch}`;
}
