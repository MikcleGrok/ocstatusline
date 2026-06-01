import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { LimitLookup } from './selectors.js';

type ModelsJson = Record<string, { models?: Record<string, { limit?: { context?: number } }> }>;

export function buildLimitLookup(data: ModelsJson): LimitLookup {
  return (provider, model) => {
    if (!model) return null;
    if (provider && data[provider]?.models?.[model]?.limit?.context != null) {
      return data[provider]!.models![model]!.limit!.context!;
    }
    for (const p of Object.keys(data)) {
      const ctx = data[p]?.models?.[model]?.limit?.context;
      if (ctx != null) return ctx;
    }
    return null;
  };
}

export function modelsJsonPath(): string {
  return path.join(os.homedir(), '.cache', 'opencode', 'models.json');
}

export function loadLimitLookup(): LimitLookup {
  try {
    const raw = fs.readFileSync(modelsJsonPath(), 'utf-8');
    return buildLimitLookup(JSON.parse(raw));
  } catch {
    return () => null;
  }
}
