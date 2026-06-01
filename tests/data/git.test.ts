import { describe, it, expect } from 'vitest';
import { parseGit } from '../../src/data/git';

describe('parseGit', () => {
  it('parses branch, dirty, ahead/behind, changes, sha from porcelain v2', () => {
    const out = [
      '# branch.oid abcdef1234567890',
      '# branch.head main',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 aaa bbb file1.ts',
      '? untracked.ts',
    ].join('\n');
    const g = parseGit(out);
    expect(g.isRepo).toBe(true);
    expect(g.branch).toBe('main');
    expect(g.ahead).toBe(2);
    expect(g.behind).toBe(1);
    expect(g.changes).toBe(2); // one modified + one untracked
    expect(g.dirty).toBe(true);
    expect(g.sha).toBe('abcdef1');
  });
  it('clean repo: dirty false, changes 0', () => {
    const out = ['# branch.oid abcdef1234567890', '# branch.head main', '# branch.ab +0 -0'].join('\n');
    const g = parseGit(out);
    expect(g.dirty).toBe(false);
    expect(g.changes).toBe(0);
  });
  it('empty output → not a repo', () => {
    expect(parseGit('').isRepo).toBe(false);
  });
});
