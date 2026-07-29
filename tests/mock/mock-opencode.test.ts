import { describe, it, expect, afterEach } from 'vitest';
import { sseFrame, startMock, type MockHandle } from './mock-opencode';

const HAS_BUN = typeof Bun !== 'undefined';

let handle: MockHandle | null = null;
afterEach(() => { handle?.stop(); handle = null; });

const FIXTURE = 'normal-session.jsonl';

describe('sseFrame', () => {
  it('frames an event as a nameless SSE data line', () => {
    expect(sseFrame({ type: 'session.idle' })).toBe('data: {"type":"session.idle"}\n\n');
  });
});

describe.skipIf(!HAS_BUN)('startMock', () => {
  it('reports health together with the fixture size', async () => {
    handle = startMock({ port: 0, fixture: FIXTURE, delayMs: 0, loop: false });
    const res = await fetch(`${handle.url}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', events: 4 });
  });

  it('replays every fixture event over SSE and then closes the stream', async () => {
    handle = startMock({ port: 0, fixture: FIXTURE, delayMs: 0, loop: false });
    const res = await fetch(`${handle.url}/event`);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const frames = (await res.text()).split('\n\n').filter((f) => f.length > 0);
    expect(frames).toHaveLength(4);
    expect(JSON.parse(frames[0].replace(/^data: /, ''))).toMatchObject({ type: 'message.updated' });
    expect(JSON.parse(frames[3].replace(/^data: /, ''))).toMatchObject({ type: 'session.idle' });
  });

  it('serves the stream on any path containing "event"', async () => {
    handle = startMock({ port: 0, fixture: FIXTURE, delayMs: 0, loop: false });
    const res = await fetch(`${handle.url}/api/event/subscribe`);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect((await res.text()).startsWith('data: ')).toBe(true);
  });

  it('answers every other path with an empty JSON object', async () => {
    handle = startMock({ port: 0, fixture: FIXTURE, delayMs: 0, loop: false });
    const res = await fetch(`${handle.url}/app`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{}');
  });
});