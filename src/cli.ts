export type CliMode = 'tui' | 'daemon' | 'version' | 'help';

export interface CliCommand {
  mode: CliMode;
  serverUrl?: string;
  timeoutMs?: number;
}

export function parseCli(argv: string[]): CliCommand {
  if (argv.includes('--help') || argv.includes('-h') || argv[0] === 'help') return { mode: 'help' };
  if (argv.includes('--version') || argv[0] === 'version') return { mode: 'version' };
  if (argv[0] === 'start') {
    const i = argv.indexOf('--server');
    const serverUrl = i >= 0 && i < argv.length - 1 ? argv[i + 1] : undefined;
    const ti = argv.indexOf('--timeout');
    const timeoutMs = ti >= 0 && ti < argv.length - 1 ? parseInt(argv[ti + 1], 10) : undefined;
    return { mode: 'daemon', serverUrl, timeoutMs };
  }
  return { mode: 'tui' };
}