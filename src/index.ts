#!/usr/bin/env bun
import { parseCli } from './cli.js';
import { runDaemon } from './daemon.js';
import { VERSION } from './version.js';

async function main() {
  const cmd = parseCli(process.argv.slice(2));
  if (cmd.mode === 'help') {
    process.stdout.write(HELP_TEXT);
    return;
  }
  if (cmd.mode === 'version') {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (cmd.mode === 'daemon') {
    await runDaemon({ serverUrl: cmd.serverUrl, timeoutMs: cmd.timeoutMs });
    return;
  }
  const { mountTui } = await import('./tui/run.js');
  await mountTui();
}

const HELP_TEXT = `Usage: ocstatusline [command] [options]

Commands:
  (none)           Open the interactive config TUI.
  start [--server URL] [--timeout MS]
                   Run the live status-line daemon (managed server by default;
                   attach to an existing OpenCode server with --server).
  --version        Print the version and exit.
  --help           Print this message and exit.

Examples:
  ocstatusline
  ocstatusline start
  ocstatusline start --server http://127.0.0.1:4096
  ocstatusline --version

Config: ~/.config/ocstatusline/settings.json (created on first save).
Docs:   https://github.com/MikcleGrok/ocstatusline
`;

main().catch((e) => { process.stderr.write(`ocstatusline: ${e?.message ?? e}\n`); process.exit(1); });