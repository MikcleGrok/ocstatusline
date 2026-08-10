import { describe, it, expect } from 'vitest';
import { MAX_MESSAGE_ENTRIES, reduce } from '../../src/data/event-reducer';
import { emptyState } from '../../src/types/index';

function assistantMsg(id: string, over: any = {}) {
  return {
    type: 'message.updated',
    properties: { info: {
      id, role: 'assistant', sessionID: 's1', modelID: 'qwen3-coder', providerID: 'ollama',
      mode: 'build', path: { cwd: '/proj', root: '/proj' }, time: { created: 1000 },
      cost: 0.01, tokens: { input: 100, output: 20, reasoning: 0, cache: { read: 5, write: 2 } },
      ...over,
    } },
  } as any;
}

describe('reduce', () => {
  it('captures model/provider/mode/cwd from an assistant message', () => {
    const s = reduce(emptyState(), assistantMsg('m1'));
    expect(s.latestAssistantID).toBe('m1');
    expect(s.byMessage['m1'].modelID).toBe('qwen3-coder');
    expect(s.byMessage['m1'].providerID).toBe('ollama');
    expect(s.byMessage['m1'].mode).toBe('build');
    expect(s.byMessage['m1'].cwd).toBe('/proj');
    expect(s.sessionStart).toBe(1000);
  });
  it('dedupes streaming updates for the same id (no double count)', () => {
    let s = reduce(emptyState(), assistantMsg('m1', { cost: 0.01 }));
    s = reduce(s, assistantMsg('m1', { cost: 0.03 })); // same id, updated
    expect(Object.keys(s.byMessage)).toHaveLength(1);
    expect(s.byMessage['m1'].cost).toBe(0.03);
  });
  it('accumulates distinct assistant messages', () => {
    let s = reduce(emptyState(), assistantMsg('m1', { cost: 0.01 }));
    s = reduce(s, assistantMsg('m2', { cost: 0.02, time: { created: 2000 } }));
    expect(Object.keys(s.byMessage)).toHaveLength(2);
    expect(s.sessionStart).toBe(1000); // earliest wins
  });
  it('bounds message retention while keeping the latest aggregate', () => {
    let s = emptyState();
    for (let i = 0; i <= MAX_MESSAGE_ENTRIES; i++) s = reduce(s, assistantMsg(`m${i}`, { time: { created: i }, cost: 1 }));
    expect(Object.keys(s.byMessage)).toHaveLength(MAX_MESSAGE_ENTRIES);
    expect(s.byMessage.m0).toBeUndefined();
    expect(s.latestAssistantID).toBe(`m${MAX_MESSAGE_ENTRIES}`);
    expect(s.byMessage[`m${MAX_MESSAGE_ENTRIES}`].cost).toBe(1);
  });
  it('uses delivery order for FIFO eviction, regardless of message timestamps', () => {
    let s = emptyState();
    for (let i = 0; i < MAX_MESSAGE_ENTRIES; i++) s = reduce(s, assistantMsg(`m${i}`, { time: { created: i } }));
    s = reduce(s, assistantMsg('delivered-last', { time: { created: 0 } }));
    expect(s.byMessage.m0).toBeUndefined();
    expect(s.byMessage['delivered-last']).toBeDefined();
    expect(s.latestAssistantID).toBe('delivered-last');
  });
  it('session.idle sets idle true; message activity sets idle false', () => {
    let s = reduce(emptyState(), assistantMsg('m1'));
    expect(s.idle).toBe(false);
    s = reduce(s, { type: 'session.idle', properties: {} } as any);
    expect(s.idle).toBe(true);
  });
  it('ignores unknown event types', () => {
    const s0 = emptyState();
    const s1 = reduce(s0, { type: 'weird.thing', properties: {} } as any);
    expect(s1.byMessage).toEqual({});
  });
  it('leaves state unchanged for non-assistant message.updated', () => {
    const s0 = reduce(emptyState(), assistantMsg('m1'));
    const s1 = reduce(s0, { type: 'message.updated', properties: { info: { id: 'u1', role: 'user' } } } as any);
    expect(s1).toBe(s0); // same reference: no allocation, no idle flip
    expect(Object.keys(s1.byMessage)).toEqual(['m1']);
  });
});
