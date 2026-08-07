import { emptyState, type MsgAgg, type RenderContext, type Settings } from '../../src/types/index.js';
import { defaultSettings } from '../../src/utils/config.js';

export class RenderContextBuilder {
  private value: RenderContext = {
    state: emptyState(),
    derived: { model: 'qwen3-coder', provider: 'ollama', mode: 'build', cwd: '/tmp/project', totalTokens: 1234, contextTokens: 6553, contextLimit: 65536, cost: 0.042, sessionDurationMs: 192000 },
    git: { isRepo: true, branch: 'main', dirty: true, ahead: 2, behind: 0, changes: 3, sha: 'abcdef1' },
    termWidth: 120,
    now: 0,
    openrouterWeekly: { source: null, balanceUsd: null, budgetUsd: 25, spentUsd: 0, remainingUsd: 25, windowStartMs: 0, windowEndMs: 0 },
  };

  with(overrides: Partial<RenderContext>): this {
    this.value = { ...this.value, ...overrides };
    return this;
  }

  build(): RenderContext {
    return this.value;
  }
}

export function renderContext(): RenderContextBuilder {
  return new RenderContextBuilder();
}

export class SettingsBuilder {
  private value: Settings = defaultSettings();

  with(overrides: Partial<Settings>): this {
    this.value = { ...this.value, ...overrides };
    return this;
  }

  build(): Settings {
    return this.value;
  }
}

export function settings(): SettingsBuilder {
  return new SettingsBuilder();
}

export function assistantMessage(id: string, overrides: Partial<MsgAgg> = {}): MsgAgg {
  return { role: 'assistant', cost: 0.01, tokens: { input: 100, output: 20, reasoning: 0, cacheRead: 5, cacheWrite: 2, total: 120 }, modelID: 'qwen3-coder', providerID: 'ollama', mode: 'build', cwd: '/tmp/project', created: 1000, ...overrides };
}
