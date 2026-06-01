#!/usr/bin/env node
import { parseCli } from './cli.js';
import { runDaemon } from './daemon.js';

async function main() {
  const cmd = parseCli(process.argv.slice(2));
  if (cmd.mode === 'daemon') {
    await runDaemon({ serverUrl: cmd.serverUrl });
    return;
  }
  // TUI mode is wired in Task 8.
  process.stderr.write('ocstatusline: config TUI not yet available; use "ocstatusline start"\n');
  process.exit(1);
}

main().catch((e) => { process.stderr.write(`ocstatusline: ${e?.message ?? e}\n`); process.exit(1); });
