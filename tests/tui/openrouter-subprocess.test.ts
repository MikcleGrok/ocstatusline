import { describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchOpenRouterStatusViaBinary, parseOpenRouterStatus } from '../../src/tui/openrouter-subprocess.js';

// Writes a tiny executable shell script standing in for the real
// `ocstatusline` binary, so these tests exercise the real subprocess-spawn
// path (execFile, timeout, signal, argv) without depending on a compiled
// binary or a running secretd -- the same "spawn something real and small"
// approach src/tui/footer.ts's getTuiGitInfo tests use for git.
function writeFixtureBinary(body: string): { path: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ocsl-fixture-bin-'));
  const path = join(dir, 'ocstatusline-fixture');
  writeFileSync(path, `#!/bin/sh\n${body}\n`, 'utf-8');
  chmodSync(path, 0o755);
  return { path, dir };
}

describe('parseOpenRouterStatus', () => {
  it('parses a well-formed status line', () => {
    expect(parseOpenRouterStatus('{"balance":{"source":"account","balanceUsd":47.78},"usage":12.5}\n')).toEqual({ balance: { source: 'account', balanceUsd: 47.78 }, usage: 12.5 });
  });
  it('accepts a null balance and null usage', () => {
    expect(parseOpenRouterStatus('{"balance":null,"usage":null}')).toEqual({ balance: null, usage: null });
  });
  it('rejects a balance with an unknown source', () => {
    expect(parseOpenRouterStatus('{"balance":{"source":"other","balanceUsd":1},"usage":null}')).toEqual({ balance: null, usage: null });
  });
  it('rejects a non-finite balanceUsd', () => {
    expect(parseOpenRouterStatus('{"balance":{"source":"account","balanceUsd":"1"},"usage":null}')).toEqual({ balance: null, usage: null });
  });
  it('rejects a non-finite usage', () => {
    expect(parseOpenRouterStatus('{"balance":null,"usage":"5"}')).toEqual({ balance: null, usage: null });
  });
  it('fails closed on malformed JSON', () => {
    expect(parseOpenRouterStatus('not json')).toEqual({ balance: null, usage: null });
  });
  it('fails closed on a well-formed but unexpected shape', () => {
    expect(parseOpenRouterStatus('[1,2,3]')).toEqual({ balance: null, usage: null });
    expect(parseOpenRouterStatus('"just a string"')).toEqual({ balance: null, usage: null });
  });
});

describe('fetchOpenRouterStatusViaBinary', () => {
  it('parses well-formed stdout from the real binary invocation', async () => {
    const { path, dir } = writeFixtureBinary('printf \'{"balance":{"source":"account","balanceUsd":9.5},"usage":1}\\n\'');
    try {
      const result = await fetchOpenRouterStatusViaBinary(1000, undefined, [path]);
      expect(result).toEqual({ balance: { source: 'account', balanceUsd: 9.5 }, usage: 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('invokes the binary with exactly the "openrouter-status" argument', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ocsl-fixture-bin-'));
    const argvFile = join(dir, 'argv.txt');
    const path = join(dir, 'ocstatusline-fixture');
    writeFileSync(path, `#!/bin/sh\nprintf '%s' "$*" > "${argvFile}"\nprintf '{"balance":null,"usage":null}\\n'\n`, 'utf-8');
    chmodSync(path, 0o755);
    try {
      await fetchOpenRouterStatusViaBinary(1000, undefined, [path]);
      expect(readFileSync(argvFile, 'utf-8')).toBe('openrouter-status');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls through to the next candidate when the first does not exist (ENOENT)', async () => {
    const { path, dir } = writeFixtureBinary('printf \'{"balance":null,"usage":null}\\n\'');
    try {
      const result = await fetchOpenRouterStatusViaBinary(1000, undefined, [join(dir, 'does-not-exist'), path]);
      expect(result).toEqual({ balance: null, usage: null });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails closed without trying further candidates when the binary exists but exits non-zero', async () => {
    const { path: bad, dir: badDir } = writeFixtureBinary('exit 1');
    const { path: good, dir: goodDir } = writeFixtureBinary('printf \'{"balance":{"source":"account","balanceUsd":1},"usage":1}\\n\'');
    try {
      const result = await fetchOpenRouterStatusViaBinary(1000, undefined, [bad, good]);
      expect(result).toEqual({ balance: null, usage: null });
    } finally {
      rmSync(badDir, { recursive: true, force: true });
      rmSync(goodDir, { recursive: true, force: true });
    }
  });

  it('fails closed when every candidate is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ocsl-fixture-bin-missing-'));
    try {
      const result = await fetchOpenRouterStatusViaBinary(1000, undefined, [join(dir, 'nope-1'), join(dir, 'nope-2')]);
      expect(result).toEqual({ balance: null, usage: null });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('times out and fails closed when the binary hangs', async () => {
    const { path, dir } = writeFixtureBinary('sleep 5');
    try {
      const result = await fetchOpenRouterStatusViaBinary(50, undefined, [path]);
      expect(result).toEqual({ balance: null, usage: null });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 10_000);

  it('resolves immediately when the signal is already aborted, without spawning anything', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await fetchOpenRouterStatusViaBinary(1000, controller.signal, ['/nonexistent/should-not-be-execed']);
    expect(result).toEqual({ balance: null, usage: null });
  });

  it('fails closed when the external signal aborts mid-call', async () => {
    const { path, dir } = writeFixtureBinary('sleep 5');
    try {
      const controller = new AbortController();
      const request = fetchOpenRouterStatusViaBinary(1000, controller.signal, [path]);
      controller.abort();
      await expect(request).resolves.toEqual({ balance: null, usage: null });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
