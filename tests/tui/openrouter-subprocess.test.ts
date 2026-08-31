import { describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchOpenRouterStatusViaBinary, parseOpenRouterStatus } from '../../src/tui/openrouter-subprocess.js';

function fixture(body: string) { const dir = mkdtempSync(join(tmpdir(), 'ocsl-bin-')); const path = join(dir, 'ocstatusline'); writeFileSync(path, `#!/bin/sh\n${body}\n`); chmodSync(path, 0o755); return { dir, path }; }

describe('openrouter subprocess contract', () => {
  it('validates JSON shape and finite numeric values', () => {
    expect(parseOpenRouterStatus('{"balance":{"source":"account","balanceUsd":4},"usage":2}\n')).toEqual({ balance: { source: 'account', balanceUsd: 4 }, usage: 2 });
    expect(parseOpenRouterStatus('{"balance":{"source":"bad","balanceUsd":4},"usage":"2"}')).toEqual({ balance: null, usage: null });
    expect(parseOpenRouterStatus('malformed')).toEqual({ balance: null, usage: null });
  });

  it('passes exactly openrouter-status and fails closed on non-zero exit', async () => {
    const good = fixture('test "$1" = openrouter-status\nprintf \'{"balance":null,"usage":null}\\n\'');
    const bad = fixture('exit 7');
    try {
      await expect(fetchOpenRouterStatusViaBinary(1000, undefined, [good.path])).resolves.toEqual({ balance: null, usage: null });
      await expect(fetchOpenRouterStatusViaBinary(1000, undefined, [bad.path, good.path])).resolves.toEqual({ balance: null, usage: null });
    } finally { rmSync(good.dir, { recursive: true, force: true }); rmSync(bad.dir, { recursive: true, force: true }); }
  });
});
