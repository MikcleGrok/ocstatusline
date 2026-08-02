import { describe, it, expect } from 'vitest';
import { defaultSettings, mergeSettings } from '../../src/utils/config';

describe('config', () => {
  it('defaultSettings has one line with model+git+context widgets and sane refresh', () => {
    const s = defaultSettings();
    expect(s.lines.length).toBe(1);
    const types = s.lines[0].map(w => w.type);
    expect(types).toContain('model');
    expect(s.refreshInterval).toBeGreaterThan(0);
  });
  it('mergeSettings fills missing fields from defaults', () => {
    const merged = mergeSettings({ refreshInterval: 500 } as any);
    expect(merged.refreshInterval).toBe(500);
    expect(merged.lines.length).toBeGreaterThan(0);
    expect(merged.powerline).toBeDefined();
  });
  it('uses and validates the weekly OpenRouter budget', () => {
    expect(mergeSettings({ openrouter: { weeklyBudgetUsd: 10 } } as any).openrouter.weeklyBudgetUsd).toBe(10);
    expect(mergeSettings({ openrouter: { weeklyBudgetUsd: Number.NaN } } as any).openrouter.weeklyBudgetUsd).toBe(25);
    expect(mergeSettings({ openrouter: { weeklyBudgetUsd: 0 } } as any).openrouter.weeklyBudgetUsd).toBe(25);
  });
});
