export interface CliCommand {
  mode: 'tui' | 'daemon';
  serverUrl?: string;
}

export function parseCli(argv: string[]): CliCommand {
  if (argv[0] === 'start') {
    const i = argv.indexOf('--server');
    const serverUrl = i >= 0 && i < argv.length - 1 ? argv[i + 1] : undefined;
    return { mode: 'daemon', serverUrl };
  }
  return { mode: 'tui' };
}
