import { describe, it, expect } from 'vitest';
import { defaultSettings, mergeSettings } from '../../src/utils/config';

describe('config', () => {
  it('defaultSettings has one line with model+mode+git+context widgets and sane refresh', () => {
    const s = defaultSettings();
    expect(s.lines.length).toBe(1);
    const types = s.lines[0].map(w => w.type);
    expect(types).toContain('model');
    expect(types).toContain('mode');
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
  it('deep-merges valid severity colors and rejects invalid values', () => {
    const merged = mergeSettings({ severityColors: { skyBlue: 12, orange: 255, teal: 1.5, darkRed: -1 } } as any);
    expect(merged.severityColors).toEqual({ skyBlue: 12, teal: 37, mutedGreen: 71, orange: 255, darkRed: 124, overBudget: 90 });
  });
});
