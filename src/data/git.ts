import { execFileSync } from 'child_process';
import type { GitInfo } from '../types/index.js';

export function parseGit(porcelain: string): GitInfo {
  const lines = porcelain.split('\n').filter(Boolean);
  if (lines.length === 0) return { isRepo: false, branch: null, dirty: false, ahead: 0, behind: 0, changes: 0, sha: null };
  let branch: string | null = null, sha: string | null = null, ahead = 0, behind = 0, changes = 0;
  for (const line of lines) {
    if (line.startsWith('# branch.head ')) branch = line.slice('# branch.head '.length).trim();
    else if (line.startsWith('# branch.oid ')) sha = line.slice('# branch.oid '.length).trim().slice(0, 7);
    else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+)\s+-(\d+)/);
      if (m) { ahead = parseInt(m[1]); behind = parseInt(m[2]); }
    } else if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('? ') || line.startsWith('u ')) {
      changes++;
    }
  }
  if (branch === '(detached)') branch = sha;
  return { isRepo: true, branch, dirty: changes > 0, ahead, behind, changes, sha };
}

export function getGitInfo(cwd: string | null): GitInfo {
  const empty: GitInfo = { isRepo: false, branch: null, dirty: false, ahead: 0, behind: 0, changes: 0, sha: null };
  if (!cwd) return empty;
  try {
    const out = execFileSync('git', ['status', '--porcelain=v2', '--branch', '--untracked-files=all'],
      { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    return parseGit(out);
  } catch {
    return empty;
  }
}
