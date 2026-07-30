import { describe, it, expect } from 'vitest';
import { reduce } from '../../src/data/event-reducer';
import { derive } from '../../src/data/selectors';
import { emptyState } from '../../src/types/index';
import { readFixture } from '../helpers/fixtures';

const NO_LIMIT = () => null;

function replay(file: string) {
  let state = emptyState();
  for (const event of readFixture(file)) {
    state = reduce(state, event);
  }
  return state;
}

describe('fixture corpus', () => {
  it('normal-session: dedupes the streamed message, keeps the earliest start, ends idle', () => {
    const state = replay('normal-session.jsonl');
    expect(Object.keys(state.byMessage)).toEqual(['msg_1', 'msg_2']);
    expect(state.latestAssistantID).toBe('msg_2');
    expect(state.sessionStart).toBe(1767225600000);
    expect(state.idle).toBe(true);

    const d = derive(state, NO_LIMIT, 1767225660000);
    expect(d.model).toBe('qwen3-coder');
    expect(d.provider).toBe('ollama');
    expect(d.mode).toBe('build');
    expect(d.cwd).toBe('/proj');
    expect(d.cost).toBeCloseTo(0.012, 6);
    expect(d.totalTokens).toBe(3870);
    expect(d.contextTokens).toBe(3300);
    expect(d.contextLimit).toBeNull();
    expect(d.sessionDurationMs).toBe(60000);
  });

  it('normal-session: the rendered cost rounds to $0.01 (what the smoke run greps for)', () => {
    const d = derive(replay('normal-session.jsonl'), NO_LIMIT, 1767225660000);
    expect(`$${d.cost.toFixed(2)}`).toBe('$0.01');
  });

  it('tool-error: session.error flips the session to idle but keeps the message data', () => {
    const state = replay('tool-error.jsonl');
    expect(state.idle).toBe(true);
    expect(Object.keys(state.byMessage)).toEqual(['msg_1']);
    expect(derive(state, NO_LIMIT, 1767225600000).cost).toBeCloseTo(0.002, 6);
  });

  it('disconnect: the truncated stream still leaves a usable state', () => {
    const state = replay('disconnect.jsonl');
    expect(Object.keys(state.byMessage)).toEqual(['msg_1']);
    expect(state.idle).toBe(false);
    expect(derive(state, NO_LIMIT, 1767225600000).cost).toBeCloseTo(0.002, 6);
  });

  it('idle-session: no assistant message means no model and no session start', () => {
    const state = replay('idle-session.jsonl');
    expect(state.byMessage).toEqual({});
    expect(state.sessionStart).toBeNull();
    expect(state.idle).toBe(true);
    const d = derive(state, NO_LIMIT, 1767225600000);
    expect(d.model).toBeNull();
    expect(d.sessionDurationMs).toBe(0);
  });

  it('garbage: every malformed event is survived, only the salvageable one lands', () => {
    expect(() => replay('garbage.jsonl')).not.toThrow();
    const state = replay('garbage.jsonl');
    expect(Object.keys(state.byMessage)).toEqual(['msg_g']);
    expect(state.byMessage['msg_g'].cost).toBe(0);
    expect(state.byMessage['msg_g'].tokens).toEqual({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 });
    expect(state.idle).toBe(true);
    const d = derive(state, NO_LIMIT, Date.now());
    expect(d.model).toBeNull();
    expect(d.cost).toBe(0);
    expect(d.totalTokens).toBe(0);
  });

  it('readFixture skips comment lines', () => {
    expect(readFixture('normal-session.jsonl')).toHaveLength(4);
    expect(readFixture('garbage.jsonl')).toHaveLength(7);
  });
});