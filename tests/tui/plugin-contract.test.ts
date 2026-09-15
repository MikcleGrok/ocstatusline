import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@opentui/solid/jsx-runtime', () => ({
  jsx: (type: string, props: Record<string, unknown>) => ({ type, props }),
}));
vi.mock('@opentui/solid/jsx-runtime.ts', () => ({
  jsx: (type: string, props: Record<string, unknown>) => ({ type, props }),
}));
vi.mock('@opentui/core', () => ({ RGBA: { fromIndex: (index: number) => index } }));
vi.mock('../../src/utils/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/config.js')>();
  return { ...actual, loadSettings: vi.fn(() => ({ openrouter: { enabled: false, weeklyBudgetUsd: 25 }, severityColors: {} })) };
});
vi.mock('../../src/data/openrouter-weekly.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/data/openrouter-weekly.js')>();
  return {
    ...actual,
    updateWeeklyState: () => ({ source: 'account', balanceUsd: 50, budgetUsd: 25, spentUsd: 0, remainingUsd: 12.34, windowStartMs: 0, windowEndMs: 100 }),
  };
});
const { fetchOpenRouterStatusViaBinary } = vi.hoisted(() => ({ fetchOpenRouterStatusViaBinary: vi.fn(async () => ({ balance: null, usage: null })) }));
vi.mock('../../src/tui/openrouter-subprocess.js', () => ({ fetchOpenRouterStatusViaBinary }));
vi.mock('../../src/tui/footer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/tui/footer.js')>();
  return { ...actual, getTuiGitInfo: vi.fn(async () => ({ isRepo: true, root: '/work/project', branch: 'main' })) };
});
vi.mock('../../src/data/project-status.js', () => ({ readProjectStatus: async () => ({ productionVersion: null }) }));

import plugin, { setTuiJsxForTests } from '../../.opencode/tui-plugins/ocstatusline';
import { getTuiGitInfo } from '../../src/tui/footer.js';
import { defaultSettings, loadSettings } from '../../src/utils/config.js';

const runTui = plugin.tui as unknown as (api: unknown) => Promise<void>;
setTuiJsxForTests(((type: unknown, props: unknown) => ({ type, props })) as never);
type SlotRegistration = { order: number; slots: Record<string, () => unknown> };

function invoke(callback: (() => unknown) | undefined): unknown {
  return callback ? callback() : null;
}

function textOf(value: unknown): string {
  if (value === null || value === undefined || typeof value === 'boolean') return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(textOf).join('');
  if (typeof value !== 'object') return '';
  const props = (value as { props?: { children?: unknown } }).props;
  return textOf(props?.children);
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`condition was not met within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function advanceUntil(predicate: () => boolean, stepMs = 10, maxSteps = 400): Promise<void> {
  for (let step = 0; step < maxSteps; step += 1) {
    if (predicate()) return;
    await vi.advanceTimersByTimeAsync(stepMs);
  }
  throw new Error(`condition was not met within ${stepMs * maxSteps}ms of fake time`);
}

type CostSession = { id: string; directory: string; parentID?: string; cost: number; time: { created: number; updated: number } };

function makeSessionCostApi(sessions: CostSession[], costOf: (sessionID: string) => number) {
  const cleanups: Array<() => void> = [];
  const registrations: SlotRegistration[] = [];
  const listCalls: string[] = [];
  const eventHandlers = new Map<string, Array<(event: unknown) => void>>();
  const byID = new Map(sessions.map((session) => [session.id, session]));
  let blocked = false;
  const api = {
    route: { current: { name: 'session', params: { sessionID: sessions[0].id } } },
    state: { path: { directory: sessions[0].directory }, session: { get: (sessionID: string) => byID.get(sessionID) }, provider: [] },
    client: {
      session: {
        list: vi.fn(async () => {
          listCalls.push(api.route.current.params.sessionID);
          if (blocked) await new Promise<void>(() => {});
          return { data: sessions };
        }),
        messages: vi.fn(async ({ sessionID }: { sessionID: string }) => ({ data: [{ info: { id: `${sessionID}-msg`, role: 'assistant', cost: costOf(sessionID), time: { created: 1 } } }] })),
      },
    },
    event: {
      on: (name: string, handler: (event: unknown) => void) => {
        const handlers = eventHandlers.get(name) ?? [];
        handlers.push(handler);
        eventHandlers.set(name, handlers);
        const cleanup = () => { eventHandlers.set(name, (eventHandlers.get(name) ?? []).filter((existing) => existing !== handler)); };
        cleanups.push(cleanup);
        return cleanup;
      },
    },
    lifecycle: { onDispose: (cleanup: () => void) => cleanups.push(cleanup) },
    slots: { register: (registration: SlotRegistration) => registrations.push(registration) },
  };
  return {
    api,
    listCalls,
    block: (value: boolean) => { blocked = value; },
    goTo: (sessionID: string) => { api.route.current = { name: 'session', params: { sessionID } }; },
    fire: (name: string, event: unknown) => { for (const handler of eventHandlers.get(name) ?? []) handler(event); },
    footer: () => textOf(invoke(registrations.find((registration) => 'app_bottom' in registration.slots)?.slots.app_bottom)),
    dispose: () => cleanups.forEach((cleanup) => cleanup()),
  };
}

function makeApi(routeName: 'home' | 'session') {
  const registrations: SlotRegistration[] = [];
  const cleanups: Array<() => void> = [];
  const session = { id: 'session-1', directory: '/work/project', model: undefined };
  const api = {
    route: { current: { name: routeName, params: routeName === 'session' ? { sessionID: session.id } : {} } },
    state: { path: { directory: '/work/project' }, session: { get: () => session }, provider: [] },
    client: {},
    event: { on: (_name: string, _handler: unknown) => { const cleanup = () => {}; cleanups.push(cleanup); return cleanup; } },
    lifecycle: { onDispose: (cleanup: () => void) => cleanups.push(cleanup) },
    slots: { register: (registration: SlotRegistration) => registrations.push(registration) },
  };
  return { api, registrations, dispose: () => cleanups.forEach((cleanup) => cleanup()) };
}

describe('TUI plugin contract', () => {
  afterEach(() => vi.useRealTimers());

  it('captures and invokes exactly one footer slot for home and session routes', async () => {
    vi.useFakeTimers();
    const home = makeApi('home');
    await runTui(home.api);
    const homeBottom = home.registrations.find((registration) => 'app_bottom' in registration.slots)?.slots.app_bottom;
    const homeFooter = home.registrations.find((registration) => 'home_footer' in registration.slots)?.slots.home_footer;

    expect(invoke(homeBottom)).toBeNull();
    expect(textOf(invoke(homeFooter))).not.toMatch(/[?$]12\.34|\$50/);
    expect([invoke(homeBottom), invoke(homeFooter)].filter((value) => value !== null && value !== undefined)).toHaveLength(1);
    home.dispose();

    const session = makeApi('session');
    await runTui(session.api);
    const sessionBottom = session.registrations.find((registration) => 'app_bottom' in registration.slots)?.slots.app_bottom;
    const sessionFooter = session.registrations.find((registration) => 'home_footer' in registration.slots)?.slots.home_footer;

    expect(textOf(invoke(sessionBottom))).not.toMatch(/[?$]12\.34|\$50/);
    expect(invoke(sessionFooter)).toBeNull();
    expect([invoke(sessionBottom), invoke(sessionFooter)].filter((value) => value !== null && value !== undefined)).toHaveLength(1);
    session.dispose();
  });

  it('renders the weekly value once and keeps the footer on one row', async () => {
    vi.useFakeTimers();
    const fixture = makeApi('home');
    await runTui(fixture.api);
    const footer = fixture.registrations.find((registration) => 'home_footer' in registration.slots)?.slots.home_footer;
    const rendered = invoke(footer);
    const text = textOf(rendered);

    expect(text).toContain('project · main');
    expect(text).not.toMatch(/[?$]12\.34|\$50/);
    expect(text).not.toContain('?');
    expect(text).not.toContain('\n');
    expect(fetchOpenRouterStatusViaBinary).not.toHaveBeenCalled();
    fixture.dispose();
  });

  it('terminates session.list pagination when the server ignores start/limit and always returns the full page', async () => {
    // Real server behavior (confirmed live): session.list ignores `start`/`limit` and always
    // returns the full session array on every call, so a loop that keeps paginating until an
    // empty page comes back never sees one and never terminates.
    const MAX_SESSION_LIST_CALLS = 8; // generous margin above the ~3 calls the stability-check loop legitimately makes
    const session = { id: 'session-1', directory: '/work/project', parentID: undefined, cost: 0, time: { created: 1, updated: 1 } };
    const sessionListCalls: unknown[] = [];
    let sessionListGuardError: Error | null = null;
    let messageCallCount = 0;
    const cleanups: Array<() => void> = [];
    const registrations: SlotRegistration[] = [];
    const api = {
      route: { current: { name: 'session', params: { sessionID: session.id } } },
      state: { path: { directory: '/work/project' }, session: { get: () => session }, provider: [] },
      client: {
        session: {
          list: vi.fn(async (params: unknown) => {
            sessionListCalls.push(params);
            if (sessionListCalls.length > MAX_SESSION_LIST_CALLS) {
              sessionListGuardError = new Error(`session.list pagination did not terminate: called ${sessionListCalls.length} times without an empty page ever coming back (the real server ignores start/limit and always returns the full list)`);
              throw sessionListGuardError;
            }
            return { data: [session] };
          }),
          messages: vi.fn(async (params: { before?: string }) => {
            messageCallCount += 1;
            if (params.before) return { data: [] };
            return { data: [{ info: { id: 'msg-1', role: 'assistant', cost: 5, time: { created: 1 } } }] };
          }),
        },
      },
      event: { on: (_name: string, _handler: unknown) => { const cleanup = () => {}; cleanups.push(cleanup); return cleanup; } },
      lifecycle: { onDispose: (cleanup: () => void) => cleanups.push(cleanup) },
      slots: { register: (registration: SlotRegistration) => registrations.push(registration) },
    };

    try {
      await runTui(api);
      // session.messages now makes exactly one unpaginated call (no working before-cursor
      // pagination on the real server — see the dedicated before-cursor test below), so this
      // only needs to wait for that single call rather than a second, before-bearing one.
      await waitUntil(() => messageCallCount >= 1 || sessionListGuardError !== null);
      if (sessionListGuardError) throw sessionListGuardError;

      expect(sessionListCalls.length).toBeGreaterThan(0);
      expect(sessionListCalls.length).toBeLessThanOrEqual(MAX_SESSION_LIST_CALLS);

      const sessionBottom = registrations.find((registration) => 'app_bottom' in registration.slots)?.slots.app_bottom;
      expect(textOf(invoke(sessionBottom))).toContain('$5.00');
    } finally {
      cleanups.forEach((cleanup) => cleanup());
    }
  });

  it('never issues a before-cursor call to session.messages because the server has no working pagination for it', async () => {
    // Real server behavior (confirmed live against a real headless `opencode serve`, app version
    // 1.18.31): session.messages returns HTTP 400 unconditionally for ANY call carrying a
    // `before` cursor, even though the server's own OpenAPI schema declares the parameter. A call
    // with no `before` succeeds and returns every message. A `before`-cursor pagination loop can
    // therefore never complete for any session that has at least one message — the first call
    // succeeds, the very next (paginating) call always 400s, which used to throw all the way up
    // and retry forever, so `$session` never rendered.
    const session = { id: 'session-1', directory: '/work/project', parentID: undefined, cost: 0, time: { created: 1, updated: 1 } };
    const assistantMessages = [
      { info: { id: 'msg-1', role: 'assistant', cost: 2, time: { created: 1 } } },
      { info: { id: 'msg-2', role: 'assistant', cost: 3, time: { created: 2 } } },
    ];
    let beforeCallError: Error | null = null;
    const messageCalls: Array<{ before?: string }> = [];
    const cleanups: Array<() => void> = [];
    const registrations: SlotRegistration[] = [];
    const api = {
      route: { current: { name: 'session', params: { sessionID: session.id } } },
      state: { path: { directory: '/work/project' }, session: { get: () => session }, provider: [] },
      client: {
        session: {
          list: vi.fn(async () => ({ data: [session] })),
          messages: vi.fn(async (params: { before?: string }) => {
            messageCalls.push(params);
            if (params.before) {
              beforeCallError = new Error(`session.messages called with before=${params.before} — the real server returns HTTP 400 for any before-cursor call (no working pagination for this endpoint in this app version)`);
              throw beforeCallError;
            }
            return { data: assistantMessages };
          }),
        },
      },
      event: { on: (_name: string, _handler: unknown) => { const cleanup = () => {}; cleanups.push(cleanup); return cleanup; } },
      lifecycle: { onDispose: (cleanup: () => void) => cleanups.push(cleanup) },
      slots: { register: (registration: SlotRegistration) => registrations.push(registration) },
    };

    try {
      await runTui(api);
      const sessionBottom = registrations.find((registration) => 'app_bottom' in registration.slots)?.slots.app_bottom;
      await waitUntil(() => beforeCallError !== null || textOf(invoke(sessionBottom)).includes('$5.00'));
      if (beforeCallError) throw beforeCallError;

      expect(textOf(invoke(sessionBottom))).toContain('$5.00');
      expect(messageCalls.some((call) => call.before)).toBe(false);
    } finally {
      cleanups.forEach((cleanup) => cleanup());
    }
  });

  it('recomputes the session cost immediately when a tracked event fires mid-interval, not only via the 15s timer', async () => {
    // Gap: makeSessionCostApi's event.on stub used to discard every handler, so no test ever fired
    // a real event through it — only the wall-clock backstop above was covered. A message mutation
    // for the tracked session must show up in the footer well before the 15s timer would have fired
    // on its own. It gets there without any further session.list call: updateMessage() patches the
    // in-memory aggregate directly and bump()s a re-render, per the "Контракт событий" section of
    // .task/opencode-session-cost-footer/learn.md.
    vi.useFakeTimers();
    const fixture = makeSessionCostApi([{ id: 'session-1', directory: '/work/project', cost: 0, time: { created: 1, updated: 1 } }], () => 5);
    try {
      await runTui(fixture.api);
      await advanceUntil(() => fixture.footer().includes('$5.00'));
      const settledCalls = fixture.listCalls.length;

      fixture.fire('message.updated', { properties: { info: { id: 'session-1-msg', sessionID: 'session-1', role: 'assistant', cost: 8, time: { created: 1 } } } });
      await vi.advanceTimersByTimeAsync(200); // far short of the 15s SESSION_COST_REFRESH_INTERVAL

      expect(fixture.footer()).toContain('$8.00');
      expect(fixture.listCalls.length).toBe(settledCalls);
    } finally {
      fixture.dispose();
    }
  });

  it('renders session cost with weekly/account balances but no repository segment outside a git repository', async () => {
    // Gap: every session-cost test mocked getTuiGitInfo as isRepo:true, and every non-git footer
    // test exercised formatTuiFooterSegments directly rather than a real sessionCost segment
    // through the full runTui path — so the git-gate split and the session-cost cache were never
    // proven to compose correctly together outside a repository.
    vi.useFakeTimers();
    vi.mocked(getTuiGitInfo).mockResolvedValueOnce({ isRepo: false, root: null, branch: null });
    vi.mocked(loadSettings).mockReturnValueOnce({ ...defaultSettings(), openrouter: { enabled: true, weeklyBudgetUsd: 25 } });
    const fixture = makeSessionCostApi([{ id: 'session-1', directory: '/work/project', cost: 0, time: { created: 1, updated: 1 } }], () => 5);
    try {
      await runTui(fixture.api);
      await advanceUntil(() => fixture.footer().includes('$5.00'));

      const text = fixture.footer();
      expect(text).toContain('$5.00');
      expect(text).toContain('$12.34');
      expect(text).toContain('$50');
      expect(text).not.toContain('project · main');
    } finally {
      fixture.dispose();
    }
  });
});
