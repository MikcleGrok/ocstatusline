#!/usr/bin/env node
import { parseCli } from './cli.js';
import { runDaemon } from './daemon.js';

async function main() {
  const cmd = parseCli(process.argv.slice(2));
  if (cmd.mode === 'daemon') {
    await runDaemon({ serverUrl: cmd.serverUrl });
    return;
  }
  const { mountTui } = await import('./tui/run.js');
  await mountTui();
}

main().catch((e) => { process.stderr.write(`ocstatusline: ${e?.message ?? e}\n`); process.exit(1); });
