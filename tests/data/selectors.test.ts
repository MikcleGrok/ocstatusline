import { describe, it, expect } from 'vitest';
import { derive } from '../../src/data/selectors';
import { emptyState } from '../../src/types/index';
import { reduce } from '../../src/data/event-reducer';

function asst(id: string, over: any = {}) {
  return { type: 'message.updated', properties: { info: {
    id, role: 'assistant', modelID: 'qwen3-coder', providerID: 'ollama', mode: 'build',
    path: { cwd: '/proj' }, time: { created: 1000 }, cost: 0.01,
    tokens: { input: 1000, output: 50, reasoning: 0, cache: { read: 200, write: 0 } }, ...over,
  } } } as any;
}
const getLimit = (_p: string|null, m: string|null) => (m === 'qwen3-coder' ? 65536 : null);

describe('derive', () => {
  it('sums cost across messages and uses latest model/provider/mode/cwd', () => {
    let s = reduce(emptyState(), asst('m1', { cost: 0.01 }));
    s = reduce(s, asst('m2', { cost: 0.02, time: { created: 2000 } }));
    const d = derive(s, getLimit, 5000);
    expect(d.cost).toBeCloseTo(0.03);
    expect(d.model).toBe('qwen3-coder');
    expect(d.provider).toBe('ollama');
    expect(d.mode).toBe('build');
    expect(d.cwd).toBe('/proj');
  });
  it('contextTokens = latest input + cache; contextLimit from lookup', () => {
    const s = reduce(emptyState(), asst('m1'));
    const d = derive(s, getLimit, 5000);
    expect(d.contextTokens).toBe(1200); // 1000 input + 200 cache read + 0 write
    expect(d.contextLimit).toBe(65536);
  });
  it('sessionDurationMs from sessionStart to now', () => {
    const s = reduce(emptyState(), asst('m1', { time: { created: 1000 } }));
    const d = derive(s, getLimit, 4000);
    expect(d.sessionDurationMs).toBe(3000);
  });
  it('empty state yields nulls and zeros', () => {
    const d = derive(emptyState(), getLimit, 0);
    expect(d.model).toBeNull();
    expect(d.cost).toBe(0);
    expect(d.totalTokens).toBe(0);
  });
});
