#!/usr/bin/env bun

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

type Slot = () => unknown;
type AcceptanceSpan = { text: string; fg: { buffer: Uint16Array } };
type AcceptanceSetup = {
  renderer: { destroy: () => void; getSchedulerState: () => { isRunning: boolean; isRendering: boolean; hasScheduledRender: boolean } };
  renderOnce: () => Promise<void>;
  flush: (options?: { maxPasses?: number }) => Promise<void>;
  captureCharFrame: () => string;
  captureSpans: () => { lines: Array<{ spans: AcceptanceSpan[] }> };
  getNativeStats: () => { nativeFrameCount: number };
};
type TestRender = (render: () => unknown, options: { width: number; height: number; footerHeight?: number }) => Promise<AcceptanceSetup>;
type NativeCapture = {
  frame: string;
  spans: AcceptanceSpan[];
  nativeFrameCount: number;
};

function captureNativeFrame(setup: AcceptanceSetup): NativeCapture {
  return {
    frame: setup.captureCharFrame(),
    spans: setup.captureSpans().lines.flatMap((line) => line.spans),
    nativeFrameCount: setup.getNativeStats().nativeFrameCount,
  };
}

function readGitValue(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function expectedCheckoutIdentity(): { repo: string; ref: string } {
  const root = readGitValue(['rev-parse', '--show-toplevel']);
  const branch = readGitValue(['branch', '--show-current']);
  if (branch) return { repo: basename(root), ref: branch };
  const commit = readGitValue(['rev-parse', '--short', 'HEAD']);
  const githubRef = process.env.GITHUB_REF_NAME?.trim();
  return { repo: basename(root), ref: commit || githubRef || 'HEAD' };
}

function isVisualIdleTimeout(error: unknown): boolean {
  return error instanceof Error && /^Timed out waiting for visual idle after \d+ frames\n/.test(error.message);
}

async function waitForNativeFrame(setup: AcceptanceSetup, predicate: (capture: NativeCapture) => boolean, timeoutMs: number): Promise<NativeCapture> {
  const deadline = Date.now() + timeoutMs;
  let capture = captureNativeFrame(setup);
  while (Date.now() < deadline) {
    await setup.renderOnce();
    try {
      await setup.flush({ maxPasses: 8 });
    } catch (error: unknown) {
      if (!isVisualIdleTimeout(error)) throw error;
    }
    capture = captureNativeFrame(setup);
    if (capture.nativeFrameCount > 0 && capture.spans.some((span) => span.text.trim().length > 0) && predicate(capture)) return capture;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for committed native spans after ${timeoutMs}ms: ${JSON.stringify({ nativeFrameCount: capture.nativeFrameCount, scheduler: setup.renderer.getSchedulerState(), spans: capture.spans.map((span) => span.text), frame: capture.frame })}`);
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
        assert.ok(request.module === 'openrouter/credits' || request.module === 'openrouter/usage');
        socket.write(`${JSON.stringify({ ok: true, result: request.module === 'openrouter/credits' ? 10 : 0 })}\n`);
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
    const acceptanceModel = { cost: { input: 0.15, output: 0.6, cache: { read: 0.02, write: 0.3 }, experimentalOver200K: { input: 0.3, output: 1.2, cache: { read: 0.04, write: 0.6 } } }, limit: { context: 1_000_000 } };
    const api = {
      route: { current: { name: 'session', params: { sessionID: 'acceptance-session' } } },
      state: {
        path: { directory: process.cwd() },
        session: { get: (sessionID: string) => sessionID === 'acceptance-session' ? { directory: process.cwd(), model: { providerID: 'acceptance-provider', id: 'acceptance-model' } } : undefined },
        provider: [{ id: 'acceptance-provider', models: { 'acceptance-model': acceptanceModel } }],
      },
      event: { on: () => () => undefined },
      lifecycle: { onDispose: (cleanup: () => void) => { disposePlugin = cleanup; } },
      slots: { register: (registration: { slots: { app_bottom?: Slot } }) => { if (registration.slots.app_bottom) appBottom = registration.slots.app_bottom; } },
    };

    await plugin.tui(api as never);
    assert.ok(appBottom, 'production plugin did not register app_bottom');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const setup = await testRender(() => appBottom!(), { width: 240, height: 4, footerHeight: 1 });
    renderer = setup.renderer;
    const expected = expectedCheckoutIdentity();
    const expectedRepository = `${expected.repo} · ${expected.ref}`;
    const capture = await waitForNativeFrame(setup, ({ frame, spans }) => {
      const spanText = spans.map((span) => span.text).join('');
      return frame.includes('$25.00') && frame.includes('$10') && frame.includes('$0.15/0.6 | $0.3/1.2 >200K · 1M') && frame.includes(expectedRepository) && spanText.includes('$25.00') && spanText.includes('$10') && spanText.includes('$0.15/0.6 | $0.3/1.2 >200K · 1M') && spanText.includes(expectedRepository);
    }, 10_000);
    const { frame, spans } = capture;
    const spanText = spans.map((span) => span.text).join('');
    const weeklySpan = spans.find((span) => span.text === '$25.00');
    const accountSpan = spans.find((span) => span.text === '$10');
    assert.match(frame, /\$25\.00/);
    assert.ok(frame.includes(expectedRepository), `footer did not contain expected repository/ref: ${expectedRepository}`);
    assert.match(frame, /\$10/);
    assert.match(frame, /\$0\.15\/0\.6 \| \$0\.3\/1\.2 >200K · 1M/);
    assert.match(spanText, /\$25\.00/);
    assert.ok(spanText.includes(expectedRepository), `native spans did not contain expected repository/ref: ${expectedRepository}`);
    assert.match(spanText, /\$10/);
    assert.match(spanText, /\$0\.15\/0\.6 \| \$0\.3\/1\.2 >200K · 1M/);
    assert.ok(spanText.indexOf('$0.15/0.6') < spanText.indexOf('$10'), 'model cost must be directly before account balance');
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
