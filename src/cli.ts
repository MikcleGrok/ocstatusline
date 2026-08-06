export type CliMode = 'tui' | 'daemon' | 'stdin-render' | 'version' | 'help' | 'error' | 'install';

export interface CliCommand {
  mode: CliMode;
  error?: string;
  serverUrl?: string;
  timeoutMs?: number;
}

export function parseCli(argv: string[]): CliCommand {
  if (argv[0] === 'render') {
    if (argv.length === 2 && argv[1] === '--stdin') return { mode: 'stdin-render' };
    if (argv[1] === '--stdin') return { mode: 'error', error: 'render --stdin does not accept additional arguments' };
    return { mode: 'error', error: 'render requires exactly --stdin' };
  }
  if (argv.includes('--help') || argv.includes('-h') || argv[0] === 'help') return { mode: 'help' };
  if (argv.includes('--version') || (argv.length === 1 && argv[0] === '-v') || argv[0] === 'version') return { mode: 'version' };
  if (argv[0] === 'install') return { mode: 'install' };
  if (argv[0] === 'start') {
    const i = argv.indexOf('--server');
    const serverUrl = i >= 0 && i < argv.length - 1 ? argv[i + 1] : undefined;
    const ti = argv.indexOf('--timeout');
    const timeoutMs = ti >= 0 && ti < argv.length - 1 ? parseInt(argv[ti + 1], 10) : undefined;
    return { mode: 'daemon', serverUrl, timeoutMs };
  }
  return { mode: 'tui' };
}
