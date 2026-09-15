import { createSignal } from 'solid-js';
import { jsx } from '@opentui/solid/jsx-runtime';
import { RGBA } from '@opentui/core';
import type { TuiPluginModule } from '@opencode-ai/plugin/tui';
import type { Message, Session } from '@opencode-ai/sdk/v2';
import { formatTuiFooterSegments, formatTuiModelCost, getTuiGitInfo, gitInfoForRoute, tuiRouteKey, tuiRouteSnapshot, type TuiFooterSegment, type TuiGitInfo, type TuiRouteSnapshot } from '../../src/tui/footer.js';
import { readProjectStatus } from '../../src/data/project-status.js';
import { updateWeeklyState } from '../../src/data/openrouter-weekly.js';
import { fetchOpenRouterStatusViaBinary } from '../../src/tui/openrouter-subprocess.js';
import { loadSettings } from '../../src/utils/config.js';

type TuiJsx = typeof jsx;
let renderJsx: TuiJsx = jsx;

export function setTuiJsxForTests(next: TuiJsx): void {
  renderJsx = next;
}

const BALANCE_REFRESH_INTERVAL = 60_000;
const GIT_REFRESH_INTERVAL = 10_000;
const STATUS_REFRESH_INTERVAL = 2_000;
const SESSION_COST_REFRESH_INTERVAL = 15_000;
const ROUTE_POLL_INTERVAL = 100;
const MESSAGE_CONCURRENCY = 8;
const SESSION_LIST_STABLE_PASSES = 2;
const SESSION_LIST_MAX_PASSES = 6;
const RETRY_DELAY = 1_000;
const EMPTY_GIT: TuiGitInfo = { isRepo: false, root: null, branch: null };
type AssistantMessage = Extract<Message, { role: 'assistant' }>;

function sessionIDFromRoute(api: { route?: { current?: { name?: unknown; params?: { sessionID?: unknown } } } }): string | null {
  const current = api.route?.current;
  return current?.name === 'session' && typeof current.params?.sessionID === 'string' ? current.params.sessionID : null;
}

function finiteCost(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function sessionScope(sessions: ReadonlyMap<string, Session>, rootID: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const session of sessions.values()) {
    if (!session.parentID) continue;
    const ids = children.get(session.parentID) ?? [];
    ids.push(session.id);
    children.set(session.parentID, ids);
  }
  const scope = new Set<string>([rootID]);
  const pending = [rootID];
  while (pending.length > 0) {
    const parentID = pending.pop()!;
    for (const childID of children.get(parentID) ?? []) {
      if (scope.has(childID)) continue;
      scope.add(childID);
      pending.push(childID);
    }
  }
  return scope;
}

function rootSessionID(sessions: ReadonlyMap<string, Session>, selectedID: string): string {
  let currentID = selectedID;
  const visited = new Set<string>();
  while (!visited.has(currentID)) {
    visited.add(currentID);
    const parentID = sessions.get(currentID)?.parentID;
    if (!parentID || !sessions.has(parentID)) return currentID;
    currentID = parentID;
  }
  return currentID;
}

function aggregateSessionCost(sessions: ReadonlyMap<string, Session>, messages: ReadonlyMap<string, ReadonlyMap<string, number>>, loaded: ReadonlySet<string>, rootID: string | null): TuiFooterSegment | null {
  if (!rootID) return null;
  let total = 0;
  for (const sessionID of sessionScope(sessions, rootID)) {
    const sessionMessages = messages.get(sessionID);
    if (loaded.has(sessionID) && sessionMessages) {
      for (const cost of sessionMessages.values()) total += cost;
    } else {
      total += finiteCost(sessions.get(sessionID)?.cost);
    }
  }
  return { text: `$${total.toFixed(2)}`, color: 'gray' };
}

function currentModelCost(api: { route?: { current?: { name?: unknown; params?: { sessionID?: unknown } } }; state?: { session?: { get?: (sessionID: string) => unknown }; provider?: unknown } }): TuiFooterSegment | null {
  const sessionID = api.route?.current?.name === 'session' && typeof api.route.current.params?.sessionID === 'string' ? api.route.current.params.sessionID : null;
  if (!sessionID) return null;
  const selected = api.state?.session?.get?.(sessionID);
  if (!selected || typeof selected !== 'object') return null;
  const modelSelection = (selected as { model?: unknown }).model;
  if (!modelSelection || typeof modelSelection !== 'object') return null;
  const providerID = (modelSelection as { providerID?: unknown }).providerID;
  const modelID = (modelSelection as { id?: unknown }).id;
  if (typeof providerID !== 'string' || typeof modelID !== 'string') return null;
  const providerState = api.state?.provider;
  const provider = Array.isArray(providerState) ? providerState.find((item) => item && typeof item === 'object' && (item as { id?: unknown }).id === providerID) : null;
  if (!provider || typeof provider !== 'object') return null;
  const models = (provider as { models?: unknown }).models;
  const model = models && typeof models === 'object' ? (models as Record<string, unknown>)[modelID] : null;
  return formatTuiModelCost(model);
}

export function tuiTextColor(color: 'gray' | number): string | RGBA {
  return typeof color === 'number' ? RGBA.fromIndex(color) : color;
}

const module: TuiPluginModule = {
  id: 'ocstatusline',
  tui: async (api) => {
    const [revision, refresh] = createSignal(0);
    const [currentSnapshot, setCurrentSnapshot] = createSignal<TuiRouteSnapshot>(tuiRouteSnapshot(api.route.current, api.state));
    const settings = loadSettings();
    const openrouterEnabled = settings.openrouter.enabled;
    const weeklyBudgetUsd = settings.openrouter.weeklyBudgetUsd;
    let openrouterWeekly = openrouterEnabled ? updateWeeklyState(null, weeklyBudgetUsd, Date.now()) : null;
    let lastGit = EMPTY_GIT;
    let gitSessionKey: string | null = null;
    let gitLoadingKey: string | null = null;
    let gitController: AbortController | null = null;
    let productionVersion: string | null = null;
    let statusSessionKey: string | null = null;
    let statusController: AbortController | null = null;
    let sessionCosts = new Map<string, Session>();
    let sessionMessages = new Map<string, Map<string, number>>();
    let loadedMessageSessions = new Set<string>();
    let sessionCostRootID: string | null = null;
    let sessionCostRouteKey: string | null = null;
    const sessionCostCache = new Map<string, TuiFooterSegment>();
    let sessionCostGeneration = 0;
    let sessionCostController: AbortController | null = null;
    let sessionCostRefresh: Promise<void> | null = null;
    const sessionMessageRequests = new Map<string, { token: number; controller: AbortController }>();
    let sessionMutationRevision = 0;
    let messageMutationRevision = 0;
    const sessionMutations = new Map<string, { revision: number; deleted: boolean }>();
    const messageMutations = new Map<string, { revision: number; deleted: boolean }>();
    let disposed = false;
    const balanceController = new AbortController();
    const bump = () => refresh((value) => value + 1);
    const publishRoute = (snapshot: TuiRouteSnapshot): boolean => {
      const previous = currentSnapshot();
      if (snapshot.key === previous.key && snapshot.cwd === previous.cwd) return false;
      setCurrentSnapshot(snapshot);
      gitController?.abort();
      statusController?.abort();
      gitController = null;
      gitSessionKey = null;
      gitLoadingKey = null;
      lastGit = EMPTY_GIT;
      productionVersion = null;
      statusSessionKey = null;
      bump();
      return true;
    };
    const refreshBalance = async () => {
      // Shells out to the real signed `ocstatusline` binary rather than
      // connecting to secretd directly: this code runs embedded inside the
      // `opencode` process, which can never carry ocstatusline's own
      // codesign identity. See src/tui/openrouter-subprocess.ts.
      const { balance: nextBalance, usage: nextUsage } = await fetchOpenRouterStatusViaBinary(5000, balanceController.signal);
      if (disposed) return;
      openrouterWeekly = updateWeeklyState(nextBalance, nextUsage, weeklyBudgetUsd, Date.now(), openrouterWeekly);
      bump();
    };
    const refreshGit = async (snapshot: TuiRouteSnapshot) => {
      if (disposed) return;
      const { cwd, key: nextKey } = snapshot;
      if (!nextKey) return;
      if (gitController && !gitController.signal.aborted && nextKey === gitLoadingKey) return;
      const loadedKey = nextKey;
      const controller = new AbortController();
      gitController = controller;
      gitLoadingKey = loadedKey;
      const nextGit = await getTuiGitInfo(cwd, controller.signal);
      if (disposed || controller.signal.aborted || loadedKey !== currentSnapshot().key) return;
      lastGit = nextGit;
      gitSessionKey = loadedKey;
      if (gitController === controller) {
        gitController = null;
        gitLoadingKey = null;
      }
      bump();
    };
    const refreshStatus = async (snapshot: TuiRouteSnapshot) => {
      if (disposed || !snapshot.key || !snapshot.cwd || (statusController && !statusController.signal.aborted)) return;
      const loadedKey = snapshot.key;
      const controller = new AbortController();
      statusController?.abort();
      statusController = controller;
      const status = await readProjectStatus(snapshot.cwd);
      if (disposed || controller.signal.aborted || loadedKey !== currentSnapshot().key) return;
      productionVersion = status.productionVersion;
      statusSessionKey = loadedKey;
      bump();
      if (statusController === controller) statusController = null;
    };
    const loadSessionMessages = async (sessionID: string, cwd: string, generation: number) => {
      const previousRequest = sessionMessageRequests.get(sessionID);
      previousRequest?.controller.abort();
      const request = { token: (previousRequest?.token ?? 0) + 1, controller: new AbortController() };
      sessionMessageRequests.set(sessionID, request);
      const isCurrentRequest = () => sessionMessageRequests.get(sessionID)?.token === request.token;
      const controller = request.controller;
      const mutationRevision = messageMutationRevision;
      const sessionRevision = sessionMutations.get(sessionID)?.revision ?? 0;
      try {
        const next = new Map<string, number>();
        // The server has no working `before`-cursor pagination for this endpoint — any call
        // carrying `before` returns HTTP 400, even though the parameter is declared in its own
        // OpenAPI schema. It DOES honor an unpaginated call correctly and returns every message,
        // so there is nothing to paginate — one call is all this can ever need.
        const result = await api.client.session.messages({ sessionID, directory: cwd }, { signal: controller.signal });
        if (disposed || controller.signal.aborted || generation !== sessionCostGeneration || !isCurrentRequest()) return;
        if (result.error) throw result.error;
        if (!result.data) throw new Error('session messages returned no data');
        for (const entry of result.data) {
          const info = entry.info;
          if (info.role !== 'assistant') continue;
          const key = `${sessionID}:${info.id}`;
          const mutation = messageMutations.get(key);
          if (!mutation || (mutation.revision <= mutationRevision && !mutation.deleted)) next.set(info.id, finiteCost((info as AssistantMessage).cost));
        }
        const mutation = sessionMutations.get(sessionID);
        if (!sessionCosts.has(sessionID) || (mutation?.deleted && mutation.revision > sessionRevision) || !isCurrentRequest()) return;
        const current = sessionMessages.get(sessionID) ?? new Map<string, number>();
        for (const [messageID, cost] of current) {
          const messageMutation = messageMutations.get(`${sessionID}:${messageID}`);
          if (messageMutation && messageMutation.revision > mutationRevision && !messageMutation.deleted) next.set(messageID, cost);
        }
        for (const [messageID] of next) if (messageMutations.get(`${sessionID}:${messageID}`)?.deleted) next.delete(messageID);
        for (const [key, messageMutation] of messageMutations) {
          if (key.startsWith(`${sessionID}:`) && messageMutation.revision <= mutationRevision) messageMutations.delete(key);
        }
        loadedMessageSessions.add(sessionID);
        sessionMessages.set(sessionID, next);
        sessionMessageRequests.delete(sessionID);
        bump();
        return true;
      } catch {
        if (!disposed && !controller.signal.aborted && generation === sessionCostGeneration && isCurrentRequest()) {
          sessionMessageRequests.delete(sessionID);
          bump();
          if (sessionCostRouteKey !== null) setTimeout(() => {
            if (!disposed && generation === sessionCostGeneration && sessionCosts.has(sessionID)) void loadSessionMessages(sessionID, cwd, generation);
          }, RETRY_DELAY);
        }
        return false;
      }
    };
    // Stale-while-revalidate for the session-cost aggregate. A recompute nulls sessionCostRouteKey,
    // so without this the renderer blanked `$session` on every refresh, not just on first load. The
    // cache is keyed by the route key a computation succeeded under, so a value is only ever replaced
    // by a newer successful computation for that same key, and a different session never inherits
    // another session's total — it shows nothing until its own first computation lands.
    const cacheSessionCost = (key: string | null, segment: TuiFooterSegment | null): TuiFooterSegment | null => {
      if (key && segment) sessionCostCache.set(key, segment);
      return segment;
    };
    const currentSessionCost = (snapshot: TuiRouteSnapshot): TuiFooterSegment | null => {
      if (api.route.current.name !== 'session' || !snapshot.key) return null;
      if (snapshot.key === sessionCostRouteKey) return cacheSessionCost(snapshot.key, aggregateSessionCost(sessionCosts, sessionMessages, loadedMessageSessions, sessionCostRootID));
      return sessionCostCache.get(snapshot.key) ?? null;
    };
    const refreshSessionCosts = async (snapshot: TuiRouteSnapshot) => {
      sessionCostController?.abort();
      for (const request of sessionMessageRequests.values()) request.controller.abort();
      sessionMessageRequests.clear();
      messageMutations.clear();
      messageMutationRevision = 0;
      const controller = new AbortController();
      sessionCostController = controller;
      const generation = ++sessionCostGeneration;
      const sessionRevision = sessionMutationRevision;
      const selectedID = sessionIDFromRoute(api);
      const previousRouteKey = sessionCostRouteKey;
      const previousRootID = sessionCostRootID;
      const previousSessions = sessionCosts;
      const previousMessages = sessionMessages;
      const previousLoaded = loadedMessageSessions;
      sessionCostRouteKey = null;
      sessionCostRootID = null;
      loadedMessageSessions = new Set([...loadedMessageSessions].filter((id) => sessionCosts.has(id)));
      if (!selectedID || !snapshot.cwd) {
        bump();
        return;
      }
      const selected = api.state.session.get(selectedID);
      try {
        const nextSessions = new Map<string, Session>();
        let stablePasses = 0;
        for (let pass = 0; pass < SESSION_LIST_MAX_PASSES && stablePasses < SESSION_LIST_STABLE_PASSES; pass += 1) {
          let added = 0;
          // The server ignores start/limit and always returns the full session list, so there is
          // nothing to paginate — one call per stability-check pass is all this can ever need.
          const result = await api.client.session.list({ directory: snapshot.cwd }, { signal: controller.signal });
          if (disposed || controller.signal.aborted || generation !== sessionCostGeneration) return;
          if (result.error) throw result.error;
          if (!result.data) throw new Error('session list returned no data');
          for (const session of result.data) {
            if (!nextSessions.has(session.id)) added += 1;
            nextSessions.set(session.id, session);
          }
          stablePasses = added === 0 ? stablePasses + 1 : 0;
        }
        if (stablePasses < SESSION_LIST_STABLE_PASSES) throw new Error('session list did not stabilize');
        for (const [id, mutation] of sessionMutations) {
          if (mutation.deleted) nextSessions.delete(id);
          else if (mutation.revision > sessionRevision && sessionCosts.has(id)) nextSessions.set(id, sessionCosts.get(id)!);
        }
        const selectedMutation = sessionMutations.get(selectedID);
        if (selected && !selectedMutation?.deleted && !nextSessions.has(selectedID)) nextSessions.set(selectedID, selected);
        sessionCosts = nextSessions;
        sessionCostRouteKey = null;
        sessionCostRootID = sessionCosts.has(selectedID) ? rootSessionID(sessionCosts, selectedID) : null;
        if (!sessionCostRootID) {
          bump();
          return;
        }
        const scope = [...sessionScope(sessionCosts, sessionCostRootID)];
        let nextMessageIndex = 0;
        const loadWorker = async () => {
          while (nextMessageIndex < scope.length) {
            const id = scope[nextMessageIndex++];
            if (!await loadSessionMessages(id, snapshot.cwd!, generation)) throw new Error('session messages did not load');
          }
        };
        await Promise.all(Array.from({ length: Math.min(MESSAGE_CONCURRENCY, scope.length) }, loadWorker));
        if (disposed || controller.signal.aborted || generation !== sessionCostGeneration) return;
        sessionCostRouteKey = snapshot.key;
        cacheSessionCost(snapshot.key, aggregateSessionCost(sessionCosts, sessionMessages, loadedMessageSessions, sessionCostRootID));
        for (const [id, mutation] of sessionMutations) {
          if (mutation.revision <= sessionMutationRevision) sessionMutations.delete(id);
        }
        bump();
      } catch {
        if (disposed || controller.signal.aborted || generation !== sessionCostGeneration) return;
        sessionCosts = previousSessions;
        sessionMessages = previousMessages;
        loadedMessageSessions = previousLoaded;
        sessionCostRouteKey = previousRouteKey;
        sessionCostRootID = previousRouteKey === snapshot.key ? previousRootID : null;
        bump();
        setTimeout(() => {
          if (!disposed && generation === sessionCostGeneration) void refreshSessionCosts(currentSnapshot());
        }, RETRY_DELAY);
      }
    };
    // Tracks the refresh that is in flight so the wall-clock backstop below never piles a second
    // aggregate on top of one that is still running; a route change still preempts unconditionally.
    const startSessionCostRefresh = (snapshot: TuiRouteSnapshot): void => {
      const pending = refreshSessionCosts(snapshot);
      sessionCostRefresh = pending;
      const settle = () => { if (sessionCostRefresh === pending) sessionCostRefresh = null; };
      void pending.then(settle, settle);
    };
    const activeSessionScope = (): Set<string> => {
      const selectedID = sessionIDFromRoute(api);
      if (sessionCostRootID) return sessionScope(sessionCosts, sessionCostRootID);
      return selectedID && sessionCosts.has(selectedID) ? sessionScope(sessionCosts, selectedID) : new Set();
    };
    const isActiveSession = (sessionID: string): boolean => activeSessionScope().has(sessionID);
    // Prunes the one sessionCostCache entry a session could ever have populated, so a removed or
    // forgotten session's cached total does not leak forever across session switches on a
    // long-running process. Keyed exactly the way tuiRouteSnapshot builds it for a session route.
    const forgetSessionCostCache = (sessionID: string, cwd: string | undefined) => {
      const key = tuiRouteKey({ name: 'session', params: { sessionID } }, cwd);
      if (key) sessionCostCache.delete(key);
    };
    const forgetForeignSession = (session: Session) => {
      sessionMutations.delete(session.id);
      sessionCosts.delete(session.id);
      sessionMessages.delete(session.id);
      loadedMessageSessions.delete(session.id);
      sessionMessageRequests.get(session.id)?.controller.abort();
      sessionMessageRequests.delete(session.id);
      forgetSessionCostCache(session.id, session.directory);
    };
    const updateSession = (session: Session) => {
      const selectedID = sessionIDFromRoute(api);
      const scope = activeSessionScope();
      if (session.id !== selectedID && !scope.has(session.id) && (!session.parentID || !scope.has(session.parentID))) {
        forgetForeignSession(session);
        return;
      }
      const previous = sessionCosts.get(session.id);
      const costChanged = previous?.cost !== session.cost;
      sessionMutationRevision += 1;
      sessionMutations.set(session.id, { revision: sessionMutationRevision, deleted: false });
      sessionCosts.set(session.id, session);
      if (costChanged) loadedMessageSessions.delete(session.id);
      if (selectedID && sessionCosts.has(selectedID)) sessionCostRootID = rootSessionID(sessionCosts, selectedID);
      const current = currentSnapshot();
      if (sessionCostRootID && current.cwd && sessionCostRouteKey === current.key && !loadedMessageSessions.has(session.id) && sessionScope(sessionCosts, sessionCostRootID).has(session.id)) void loadSessionMessages(session.id, current.cwd, sessionCostGeneration);
      bump();
    };
    const removeSession = (session: Session) => {
      if (!isActiveSession(session.id) && session.id !== sessionIDFromRoute(api)) {
        forgetForeignSession(session);
        return;
      }
      sessionMessageRequests.get(session.id)?.controller.abort();
      sessionMessageRequests.delete(session.id);
      sessionMutationRevision += 1;
      sessionMutations.set(session.id, { revision: sessionMutationRevision, deleted: true });
      sessionCosts.delete(session.id);
      sessionMessages.delete(session.id);
      loadedMessageSessions.delete(session.id);
      forgetSessionCostCache(session.id, session.directory);
      const selectedID = sessionIDFromRoute(api);
      if (selectedID === session.id) sessionCostRootID = null;
      else if (selectedID && sessionCosts.has(selectedID)) sessionCostRootID = rootSessionID(sessionCosts, selectedID);
      bump();
    };
    const updateMessage = (sessionID: string, info: Message) => {
      if (info.role !== 'assistant' || !sessionCostRootID || !sessionScope(sessionCosts, sessionCostRootID).has(sessionID)) return;
      messageMutationRevision += 1;
      const key = `${sessionID}:${info.id}`;
      messageMutations.set(key, { revision: messageMutationRevision, deleted: false });
      const messages = sessionMessages.get(sessionID) ?? new Map<string, number>();
      messages.set(info.id, finiteCost((info as AssistantMessage).cost));
      sessionMessages.set(sessionID, messages);
      bump();
    };
    const removeMessage = (sessionID: string, messageID: string) => {
      if (!sessionCostRootID || !sessionScope(sessionCosts, sessionCostRootID).has(sessionID)) return;
      messageMutationRevision += 1;
      messageMutations.set(`${sessionID}:${messageID}`, { revision: messageMutationRevision, deleted: true });
      sessionMessages.get(sessionID)?.delete(messageID);
      bump();
    };
    const checkRoute = () => {
      const snapshot = tuiRouteSnapshot(api.route.current, api.state);
      if (publishRoute(snapshot)) { void refreshGit(snapshot); void refreshStatus(snapshot); startSessionCostRefresh(snapshot); }
    };
    const cleanups = [
      api.event.on('message.updated', (event) => updateMessage(event.properties.info.sessionID, event.properties.info)),
      api.event.on('message.removed', (event) => removeMessage(event.properties.sessionID, event.properties.messageID)),
      api.event.on('session.created', (event) => updateSession(event.properties.info)),
      api.event.on('session.updated', (event) => updateSession(event.properties.info)),
      api.event.on('session.deleted', (event) => removeSession(event.properties.info)),
      api.event.on('session.status', (event) => { if (isActiveSession(event.properties.sessionID)) bump(); }),
      api.event.on('session.idle', (event) => { if (isActiveSession(event.properties.sessionID)) bump(); }),
      api.event.on('session.error', (event) => { if (event.properties.sessionID && isActiveSession(event.properties.sessionID)) bump(); }),
    ];
    const timer = openrouterEnabled ? setInterval(refreshBalance, BALANCE_REFRESH_INTERVAL) : null;
    const gitTimer = setInterval(() => void refreshGit(currentSnapshot()), GIT_REFRESH_INTERVAL);
    const statusTimer = setInterval(() => void refreshStatus(currentSnapshot()), STATUS_REFRESH_INTERVAL);
    const routeTimer = setInterval(checkRoute, ROUTE_POLL_INTERVAL);
    // Wall-clock backstop for the event-driven recompute: events still refresh the aggregate
    // immediately, this only guarantees a floor when an event class is missed or never arrives.
    const sessionCostTimer = setInterval(() => { if (!sessionCostRefresh) startSessionCostRefresh(currentSnapshot()); }, SESSION_COST_REFRESH_INTERVAL);
    if (openrouterEnabled) void refreshBalance();
    void refreshGit(currentSnapshot());
    void refreshStatus(currentSnapshot());
    startSessionCostRefresh(currentSnapshot());
    api.lifecycle.onDispose(() => {
      disposed = true;
      if (timer) clearInterval(timer);
      clearInterval(gitTimer);
      clearInterval(statusTimer);
      clearInterval(routeTimer);
      clearInterval(sessionCostTimer);
      balanceController.abort();
      gitController?.abort();
      sessionCostController?.abort();
      for (const request of sessionMessageRequests.values()) request.controller.abort();
      sessionMessageRequests.clear();
      for (const cleanup of cleanups) cleanup();
    });
    const renderFooter = () => {
      const snapshot = currentSnapshot();
      const git = gitInfoForRoute(snapshot.key, gitSessionKey, lastGit);
      const formattedSegments = formatTuiFooterSegments(openrouterWeekly, git, Date.now(), productionVersion, settings.severityColors, snapshot.cwd);
      const segments = openrouterEnabled ? formattedSegments : formattedSegments.slice(1);
      const weekly = openrouterEnabled ? segments[0] : undefined;
      const sessionCost = currentSessionCost(snapshot);
      // Mirrors formatTuiFooterSegments' own footerFolderSegment gating: the folder segment is
      // present whenever git info is complete or a cwd is known, regardless of which one it is.
      const repository = (git.isRepo && git.root && git.branch) || snapshot.cwd ? segments[openrouterEnabled ? 1 : 0] : undefined;
      const account = segments.find((segment) => segment.text.startsWith('$') && segment !== weekly);
      const modelCost = currentModelCost(api);
      const production = segments.find((segment) => segment.text.startsWith('prod '));
      return renderJsx('box', { width: '100%', paddingLeft: 1, flexDirection: 'row', flexWrap: 'no-wrap', overflow: 'hidden', children: [
        sessionCost ? renderJsx('text', { fg: tuiTextColor(sessionCost.color), wrapMode: 'none', children: sessionCost.text }) : null,
        sessionCost && weekly ? renderJsx('text', { fg: 'gray', wrapMode: 'none', children: ' · ' }) : null,
        weekly ? renderJsx('text', { fg: tuiTextColor(weekly.color), wrapMode: 'none', children: weekly.text }) : null,
        repository ? renderJsx('text', { fg: 'gray', wrapMode: 'none', children: ' · ' }) : null,
        repository ? renderJsx('text', { fg: repository.color, wrapMode: 'none', flexShrink: 1, overflow: 'hidden', children: repository.text }) : null,
        modelCost ? null : account ? null : renderJsx('text', { fg: 'gray', wrapMode: 'none', marginLeft: 'auto', children: ' · ' }),
        modelCost ? renderJsx('text', { fg: tuiTextColor(modelCost.color), wrapMode: 'none', marginLeft: 'auto', children: modelCost.text }) : null,
        account ? renderJsx('text', { fg: 'gray', wrapMode: 'none', children: ' · ' }) : null,
        account ? renderJsx('text', { fg: tuiTextColor(account.color), wrapMode: 'none', children: account.text }) : null,
        production ? renderJsx('text', { fg: 'gray', wrapMode: 'none', marginLeft: 'auto', children: ' · ' }) : null,
        production ? renderJsx('text', { fg: tuiTextColor(production.color), wrapMode: 'none', children: production.text }) : null,
      ] });
    };
    api.slots.register({
      order: 100,
      slots: {
        app_bottom: () => {
          revision();
          return api.route.current.name === 'home' ? null : renderFooter();
        },
      },
    });
    api.slots.register({
      order: 50,
      slots: {
        home_footer: () => {
          revision();
          return api.route.current.name === 'home' ? renderFooter() : null;
        },
      },
    });
  },
};

export default module;
