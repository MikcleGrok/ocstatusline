import { describe, it, expect } from 'vitest';
import { buildLimitLookup } from '../../src/data/models';

// Shape mirrors ~/.cache/opencode/models.json: providers → models → { limit: { context } }
const sample = {
  ollama: { models: { 'qwen3-coder': { limit: { context: 65536 } } } },
  anthropic: { models: { 'claude-x': { limit: { context: 200000 } } } },
};

describe('buildLimitLookup', () => {
  it('looks up by provider+model', () => {
    const get = buildLimitLookup(sample as any);
    expect(get('ollama', 'qwen3-coder')).toBe(65536);
  });
  it('falls back to scanning all providers by model id', () => {
    const get = buildLimitLookup(sample as any);
    expect(get(null, 'claude-x')).toBe(200000);
  });
  it('returns null for unknown model', () => {
    const get = buildLimitLookup(sample as any);
    expect(get('ollama', 'nope')).toBeNull();
  });
});
