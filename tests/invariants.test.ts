import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';

const ROOT = 'src';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const sources = walk(ROOT)
  .filter((f) => /\.(ts|tsx)$/.test(f))
  .map((file) => ({ file, text: readFileSync(file, 'utf-8') }));

describe('process-spawning invariants', () => {
  it('finds source files to check at all', () => {
    expect(sources.length).toBeGreaterThan(10);
  });

  it('never uses execSync/spawnSync/exec — those take a shell string', () => {
    const offenders = sources
      .filter((s) => /\b(execSync|spawnSync|[^F]\bexec)\s*\(/.test(s.text))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it('never passes shell: true to a child process', () => {
    const offenders = sources
      .filter((s) => /shell\s*:\s*true/.test(s.text))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it('calls execFileSync only with an argv array as its second argument', () => {
    const calls: { file: string; snippet: string }[] = [];
    for (const s of sources) {
      const re = /execFileSync\(\s*([^)]{0,200})/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s.text)) !== null) calls.push({ file: s.file, snippet: m[1] });
    }
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.snippet, `${call.file}: ${call.snippet}`).toMatch(/^['"][^'"]+['"]\s*,\s*\[/);
    }
  });
});