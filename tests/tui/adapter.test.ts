import { describe, expect, it } from 'vitest';
import { assistantMessageToAgg, renderTuiFooter, sessionIDFromRoute, stateFromTuiMessages } from '../../src/tui/adapter.js';
import { defaultSettings } from '../../src/utils/config.js';

describe('TUI adapter', () => {
  it('normalizes only session routes with a session id', () => {
    expect(sessionIDFromRoute({ name: 'home' })).toBeNull();
    expect(sessionIDFromRoute({ name: 'session', params: { sessionID: 'ses_1' } })).toBe('ses_1');
    expect(sessionIDFromRoute({ name: 'session', params: { sessionID: 1 } })).toBeNull();
  });

  it('maps an SDK v2 assistant message defensively', () => {
    expect(assistantMessageToAgg({
      id: 'msg_1', role: 'assistant', cost: 0.2, modelID: 'model', providerID: 'provider', mode: 'build',
      path: { cwd: '/repo' }, time: { created: 10 }, tokens: { input: 3, output: 4, reasoning: 1, cache: { read: 2, write: 5 } },
    })).toMatchObject({ cost: 0.2, modelID: 'model', providerID: 'provider', cwd: '/repo', tokens: { input: 3, output: 4, cacheRead: 2, cacheWrite: 5 } });
    expect(assistantMessageToAgg({ id: 'user', role: 'user' })).toBeNull();
  });

  it('keeps only messages belonging to the current session', () => {
    const state = stateFromTuiMessages([
      { id: 'one', sessionID: 'ses_1', role: 'assistant', time: { created: 10 } },
      { id: 'other', sessionID: 'ses_2', role: 'assistant', time: { created: 20 } },
    ], 'ses_1', 'idle', 30);
    expect(Object.keys(state.byMessage)).toEqual(['one']);
    expect(state.latestAssistantID).toBe('one');
    expect(state.sessionStart).toBe(10);
    expect(state.idle).toBe(true);
  });

  it('renders a neutral footer on the home route', () => {
    expect(renderTuiFooter({ name: 'home' }, [], undefined, defaultSettings(), 100)).toBe('');
  });
});
