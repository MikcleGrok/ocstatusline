import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURES_DIR = join(__dirname, '..', 'fixtures', 'events');

export interface FixtureEvent {
  type: string;
  properties?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface MockOptions {
  port: number;
  fixture: string;
  delayMs: number;
  loop: boolean;
}

export interface MockHandle {
  port: number;
  url: string;
  stop(): void;
}

export function sseFrame(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function startMock(opts: MockOptions): MockHandle {
  const events = readFixture(opts.fixture);

  const server = Bun.serve({
    port: opts.port,
    hostname: '0.0.0.0',
    fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === '/healthz') {
        return new Response(JSON.stringify({ status: 'ok', events: events.length }), {
          headers: { 'content-type': 'application/json' },
        });
      }

      if (!url.pathname.includes('event')) {
        return new Response('{}', { headers: { 'content-type': 'application/json' } });
      }

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder();
          try {
            do {
              for (const event of events) {
                controller.enqueue(encoder.encode(sseFrame(event)));
                if (opts.delayMs > 0) await Bun.sleep(opts.delayMs);
              }
            } while (opts.loop);
            controller.close();
          } catch {
          }
        },
      });

      return new Response(stream, {
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        },
      });
    },
  });

  return {
    port: server.port ?? opts.port,
    url: `http://127.0.0.1:${server.port ?? opts.port}`,
    stop: () => server.stop(true),
  };
}

function readFixture(name: string): FixtureEvent[] {
  // name can be a full path or just a filename
  const path = name.startsWith('/') || name.includes('fixtures') ? name : join(FIXTURES_DIR, name);
  const content = readFileSync(path, 'utf-8');
  return content
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'))
    .map((line) => JSON.parse(line));
}

if (import.meta.main) {
  const handle = startMock({
    port: Number(process.env.MOCK_PORT ?? 4096),
    fixture: process.env.MOCK_FIXTURE ?? 'normal-session.jsonl',
    delayMs: Number(process.env.MOCK_DELAY_MS ?? 200),
    loop: process.env.MOCK_LOOP !== '0',
  });
  console.log(`mock-opencode listening on port ${handle.port}`);
}