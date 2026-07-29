import { createServer } from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURES_DIR = join(__dirname, 'fixtures');
const PORT = 4096;

interface FixtureEvent {
  type: string;
  properties?: Record<string, unknown>;
  [k: string]: unknown;
}

function loadFixture(name: string): FixtureEvent {
  const content = readFileSync(join(FIXTURES_DIR, `${name}.json`), 'utf-8');
  return JSON.parse(content);
}

const sessionStart = loadFixture('session.start');

function sseFormat(event: string, data: any): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function createSSEHandler(req: any, res: any) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  // Send initial session.start event
  res.write(sseFormat('session.start', sessionStart));

  // Send periodic tick events to keep connection alive and allow time widgets to update
  const interval = setInterval(() => {
    res.write(sseFormat('session.tick', { timestamp: Date.now() }));
  }, 1000);

  req.on('close', () => {
    clearInterval(interval);
  });
}

const server = createServer((req, res) => {
  if (req.url === '/events') {
    createSSEHandler(req, res);
  } else if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.error(`[mock-opencode] SSE server listening on http://localhost:${PORT}`);
  console.error(`[mock-opencode] Events endpoint: http://localhost:${PORT}/events`);
});