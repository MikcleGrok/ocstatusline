#!/usr/bin/env bun

import { strict as assert } from 'node:assert';
import { createServer, type Server } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

type Slot = () => unknown;
type AcceptanceSpan = { text: string; fg: { buffer: Uint16Array } };
type AcceptanceSetup = {
  renderer: { destroy: () => void };
  renderOnce: () => Promise<void>;
  flush: () => Promise<void>;
  captureCharFrame: () => string;
  waitForFrame: (predicate: (value: string) => boolean, options: { maxPasses: number }) => Promise<void>;
  captureSpans: () => { lines: Array<{ spans: AcceptanceSpan[] }> };
  getNativeStats: () => { nativeFrameCount: number };
};
type TestRender = (render: () => unknown, options: { width: number; height: number; footerHeight?: number }) => Promise<AcceptanceSetup>;

async function waitForNativeFrame(setup: AcceptanceSetup, predicate: (value: string) => boolean, maxPasses: number): Promise<void> {
  for (let pass = 0; pass < maxPasses; pass += 1) {
    await setup.renderOnce();
    await setup.flush();
    if (predicate(setup.captureCharFrame())) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await setup.waitForFrame(predicate, { maxPasses: 1 });
}

if (!process.env.OCSTATUSLINE_ACCEPTANCE_HOME) {
  const acceptanceHome = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'ocstatusline-tui-'));
  const child = Bun.spawnSync([process.execPath, import.meta.path], {
    env: { ...process.env, HOME: acceptanceHome, OCSTATUSLINE_ACCEPTANCE_HOME: acceptanceHome },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  await rm(acceptanceHome, { recursive: true, force: true });
  process.exit(child.exitCode);
}

async function listenForCredits(socketPath: string): Promise<Server> {
  const server = createServer((socket) => {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      for (const line of chunk.split('\n').filter(Boolean)) {
        const request = JSON.parse(line) as { op?: string; module?: string };
        assert.equal(request.op, 'call');
        assert.equal(request.module, 'openrouter/credits');
        socket.write(`${JSON.stringify({ ok: true, result: 10 })}\n`);
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve());
  });
  return server;
}

async function main(): Promise<void> {
  const home = process.env.OCSTATUSLINE_ACCEPTANCE_HOME;
  assert.ok(home, 'acceptance HOME was not initialized');
  const socketPath = join(home, '.secretd', 'sock');
  const originalHome = process.env.HOME;
  let server: Server | undefined;
  let disposePlugin: (() => void) | undefined;
  let renderer: { destroy: () => void } | undefined;

  try {
    await mkdir(join(home, '.secretd'), { recursive: true });
    await mkdir(join(home, '.config', 'ocstatusline'), { recursive: true });
    await writeFile(join(home, '.config', 'ocstatusline', 'settings.json'), JSON.stringify({ openrouter: { weeklyBudgetUsd: 25 } }));
    process.env.HOME = home;
    server = await listenForCredits(socketPath);
    const plugin = (await import('../../.opencode/tui-plugins/ocstatusline.js')).default as { tui: (api: unknown) => Promise<void> };
    // @ts-expect-error OpenTUI's Bun entrypoint is executable test infrastructure without declarations.
    const { testRender } = await import('../../.opencode/node_modules/@opentui/solid/index.bun.js') as unknown as { testRender: TestRender };
    let appBottom: Slot | undefined;
    const api = {
      route: { current: { name: 'home' } },
      state: { path: { directory: process.cwd() } },
      event: { on: () => () => undefined },
      lifecycle: { onDispose: (cleanup: () => void) => { disposePlugin = cleanup; } },
      slots: { register: (registration: { slots: { app_bottom?: Slot } }) => { if (registration.slots.app_bottom) appBottom = registration.slots.app_bottom; } },
    };

    await plugin.tui(api as never);
    assert.ok(appBottom, 'production plugin did not register app_bottom');
    await new Promise((resolve) => setTimeout(resolve, 100));
    const setup = await testRender(() => appBottom!(), { width: 120, height: 4, footerHeight: 1 });
    renderer = setup.renderer;
     await waitForNativeFrame(setup, (value) => value.includes('$25.00') && value.includes('$10') && /(?:src|ocstatusline) · acceptance-tui/.test(value), 300);
    const frame = setup.captureCharFrame();
    const captured = setup.captureSpans();
    const spans = captured.lines.flatMap((line) => line.spans).map((span) => span.text).join('');
    const weeklySpan = captured.lines[0]?.spans.find((span) => span.text === '$25.00');
    const accountSpan = captured.lines[0]?.spans.find((span) => span.text === '$10');
    assert.match(frame, /\$25\.00/);
    assert.match(frame, /(?:src|ocstatusline) · acceptance-tui/);
    assert.match(frame, /\$10/);
    assert.match(spans, /\$25\.00/);
    assert.match(spans, /(?:src|ocstatusline) · acceptance-tui/);
    assert.match(spans, /\$10/);
    assert.ok(weeklySpan && weeklySpan.fg.buffer instanceof Uint16Array, 'weekly footer did not use native fg');
    assert.ok(accountSpan && accountSpan.fg.buffer instanceof Uint16Array, 'account footer did not use native fg');
    assert.notEqual(weeklySpan.fg.buffer[0], 128, 'weekly footer stayed gray');
    assert.notEqual(accountSpan.fg.buffer[0], 128, 'account footer stayed gray');
    assert.ok(setup.getNativeStats().nativeFrameCount > 0, 'OpenTUI native renderer did not render a frame');
  } finally {
    disposePlugin?.();
    renderer?.destroy();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await rm(home, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(`OpenTUI acceptance failed: ${error instanceof Error ? error.stack : String(error)}`);
  process.exitCode = 1;
});
