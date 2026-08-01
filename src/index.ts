#!/usr/bin/env bun
import { parseCli } from './cli.js';
import { runDaemon } from './daemon.js';
import { VERSION } from './version.js';
import { runStdinRender } from './render/stdin.js';

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
  if (cmd.mode === 'error') {
    process.stderr.write(`ocstatusline: ${cmd.error}\n\n${HELP_TEXT}`);
    process.exitCode = 1;
    return;
  }
  if (cmd.mode === 'daemon') {
    await runDaemon({ serverUrl: cmd.serverUrl, timeoutMs: cmd.timeoutMs });
    return;
  }
  if (cmd.mode === 'stdin-render') {
    await runStdinRender();
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
  render --stdin   Read one versioned ocstatusline JSON object until EOF and
                   print plain rendered lines once (OpenCode does not invoke this automatically).
  --version        Print the version and exit.
  --help           Print this message and exit.

Examples:
  ocstatusline
  ocstatusline start
  ocstatusline start --server http://127.0.0.1:4096
  ocstatusline render --stdin < snapshot.json
  ocstatusline --version

Config: ~/.config/ocstatusline/settings.json (created on first save).
Docs:   https://github.com/MikcleGrok/ocstatusline
`;

main().catch((e) => { process.stderr.write(`ocstatusline: ${e?.message ?? e}\n`); process.exit(1); });
