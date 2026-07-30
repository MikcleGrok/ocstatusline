import { writeFileSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { connect, subscribeEvents } from '../src/data/server.js';

export function eventsToJsonl(events: unknown[]): string {
  return events.map((event) => JSON.stringify(event)).join('\n') + (events.length > 0 ? '\n' : '');
}

export interface RecordOptions {
  serverUrl?: string;
  out: string;
  max: number;
  timeoutMs: number;
}

export async function recordFixture(opts: RecordOptions): Promise<number> {
  const events: unknown[] = [];
  const conn = await connect(opts.serverUrl);
  process.stderr.write(`recording from ${conn.serverUrl}\n`);

  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const timer = setTimeout(finish, opts.timeoutMs);
    void subscribeEvents(conn.client, (event) => {
      events.push(event);
      process.stderr.write(`  event ${events.length}: ${JSON.stringify(event).slice(0, 100)}\n`);
      if (events.length >= opts.max) { clearTimeout(timer); finish(); }
    });
  });

  conn.close();
  mkdirSync(path.dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, eventsToJsonl(events), 'utf-8');
  process.stderr.write(`wrote ${events.length} events to ${opts.out}\n`);
  return events.length;
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i < argv.length - 1 ? argv[i + 1] : undefined;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const out = arg(argv, 'out');
  if (!out) {
    process.stderr.write('record-fixtures: --out <file> is required\n');
    process.exit(2);
  }
  const count = await recordFixture({
    serverUrl: arg(argv, 'server'),
    out,
    max: Number(arg(argv, 'max') ?? 40),
    timeoutMs: Number(arg(argv, 'timeout') ?? 30000),
  });
  if (count === 0) {
    process.stderr.write('record-fixtures: no events captured — was the session idle?\n');
    process.exit(1);
  }
}