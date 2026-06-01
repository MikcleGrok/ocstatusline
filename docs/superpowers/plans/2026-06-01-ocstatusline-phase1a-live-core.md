# ocstatusline Phase 1A — Live Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working, standalone live status-line daemon for OpenCode that subscribes to an OpenCode server's event stream and continuously renders a configurable status line (model, provider, mode, tokens, cost, context%, session timer, git, custom text) with Powerline/colors/flex-width, configured via a JSON file.

**Architecture:** A push-model daemon. `data/server.ts` connects an `@opencode-ai/sdk` client (managed `createOpencode()` or `--server` attach). Events fold through a pure `data/event-reducer.ts` into `OpencodeState`; `data/selectors.ts` derives display values (using `data/models.ts` for context limits and `data/git.ts` for repo info). `render/renderer.ts` composes `RenderContext` → ANSI line(s) using `render/{colors,ansi,powerline,flex}.ts` and the `widgets/*` registry. `index.ts` runs the subscribe→reduce→repaint loop plus a timer tick.

**Tech Stack:** TypeScript, Node + Bun, Vitest, `@opencode-ai/sdk`. No Ink yet (Plan 1B).

**Spec:** `docs/superpowers/specs/2026-06-01-ocstatusline-phase1-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore` | Project scaffold |
| `src/types/index.ts` | All shared types (Settings, Widget, RenderContext, OpencodeState, Derived, GitInfo, TokenSet, MsgAgg, PowerlineConfig) |
| `src/utils/config.ts` | Load/save `~/.config/ocstatusline/settings.json` + defaults |
| `src/data/event-reducer.ts` | Pure `reduce(state, event) → state` |
| `src/data/selectors.ts` | Pure `derive(state, getContextLimit) → Derived` |
| `src/data/models.ts` | `loadContextLimits()` + `getContextLimit(provider, model)` from `~/.cache/opencode/models.json` |
| `src/data/git.ts` | `getGitInfo(cwd) → GitInfo` via git CLI |
| `src/data/server.ts` | Connect SDK client (managed/attach) + `subscribeEvents(client, onEvent)` |
| `src/render/ansi.ts` | ANSI escape helpers |
| `src/render/colors.ts` | Color name/hex → ANSI by color level |
| `src/render/powerline.ts` | Powerline separator/cap rendering |
| `src/render/flex.ts` | Fit/pad/truncate segments to terminal width |
| `src/render/renderer.ts` | `renderLines(ctx, settings) → string[]` |
| `src/widgets/index.ts` | Widget registry (`WIDGETS: Record<type, Widget>`) |
| `src/widgets/*.ts` | One module per widget |
| `src/index.ts` | CLI entry: arg parse → daemon render loop |
| `tests/**` | Vitest unit tests mirroring `src/` |

---

## Task 1: Project scaffold

**Files:** Create `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "ocstatusline",
  "version": "0.1.0",
  "description": "Highly customizable live status line for OpenCode",
  "type": "module",
  "bin": { "ocstatusline": "dist/index.js" },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@opencode-ai/sdk": "^1.2.6"
  },
  "devDependencies": {
    "@types/node": "^22.13.9",
    "tsx": "^4.19.2",
    "typescript": "^5.8.2",
    "vitest": "^2.1.9"
  },
  "license": "MIT"
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } });
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
*.log
```

- [ ] **Step 5: Install deps and verify**

Run: `npm install`
Expected: completes; `node_modules/@opencode-ai/sdk` present.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore
git commit -m "chore: scaffold ocstatusline project"
```

---

## Task 2: Core types

**Files:** Create `src/types/index.ts`.

- [ ] **Step 1: Write the types**

```ts
export interface TokenSet {
  input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number;
}
export interface MsgAgg {
  role: string; cost: number; tokens: TokenSet;
  modelID?: string; providerID?: string; mode?: string; cwd?: string; created: number;
}
export interface OpencodeState {
  connected: boolean;
  idle: boolean;
  byMessage: Record<string, MsgAgg>;
  latestAssistantID: string | null;
  sessionStart: number | null;
  lastUpdate: number;
}
export interface Derived {
  model: string | null; provider: string | null; mode: string | null; cwd: string | null;
  totalTokens: number; contextTokens: number; contextLimit: number | null; cost: number;
  sessionDurationMs: number;
}
export interface GitInfo {
  isRepo: boolean; branch: string | null; dirty: boolean;
  ahead: number; behind: number; changes: number; sha: string | null;
}
export interface RenderContext {
  state: OpencodeState;
  derived: Derived;
  git: GitInfo;
  termWidth: number;
  now: number;
}
export type ColorLevel = 'ansi16' | 'ansi256' | 'truecolor';
export interface WidgetConfig {
  type: string;
  color?: string;     // name (e.g. "cyan") or hex (e.g. "#88c0d0")
  bold?: boolean;
  [k: string]: unknown;
}
export interface Widget {
  type: string;
  label: string;
  render(ctx: RenderContext, cfg: WidgetConfig): string | null; // null/"" → hidden
}
export interface PowerlineConfig {
  enabled: boolean;
  separator: string;      // e.g. ""
  separatorReverse: string; // e.g. ""
}
export interface Settings {
  lines: WidgetConfig[][];
  refreshInterval: number; // ms
  colorLevel: ColorLevel;
  powerline: PowerlineConfig;
}
export function emptyState(): OpencodeState {
  return { connected: false, idle: true, byMessage: {}, latestAssistantID: null, sessionStart: null, lastUpdate: 0 };
}
export function zeroTokens(): TokenSet {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): core domain types"
```

---

## Task 3: Config load/save + defaults

**Files:** Create `src/utils/config.ts`; Test `tests/utils/config.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/utils/config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Settings } from '../types/index.js';

export function configPath(): string {
  return path.join(os.homedir(), '.config', 'ocstatusline', 'settings.json');
}

export function defaultSettings(): Settings {
  return {
    refreshInterval: 1000,
    colorLevel: 'truecolor',
    powerline: { enabled: false, separator: '', separatorReverse: '' },
    lines: [[
      { type: 'model', color: 'cyan', bold: true },
      { type: 'separator' },
      { type: 'git-branch', color: 'magenta' },
      { type: 'separator' },
      { type: 'context-percentage', color: 'yellow' },
      { type: 'separator' },
      { type: 'cost', color: 'green' },
      { type: 'separator' },
      { type: 'session-timer', color: 'blue' },
    ]],
  };
}

export function mergeSettings(partial: Partial<Settings>): Settings {
  const d = defaultSettings();
  return {
    refreshInterval: partial.refreshInterval ?? d.refreshInterval,
    colorLevel: partial.colorLevel ?? d.colorLevel,
    powerline: { ...d.powerline, ...(partial.powerline ?? {}) },
    lines: partial.lines && partial.lines.length ? partial.lines : d.lines,
  };
}

export function loadSettings(): Settings {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8');
    return mergeSettings(JSON.parse(raw));
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: Settings): void {
  const p = configPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(s, null, 2), 'utf-8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/utils/config.test.ts`
Expected: PASS (2).

- [ ] **Step 5: Commit**

```bash
git add src/utils/config.ts tests/utils/config.test.ts
git commit -m "feat(config): settings load/save with defaults"
```

---

## Task 4: Event reducer (the heart)

Folds OpenCode events into `OpencodeState`. Handles streaming dedupe (same `message.id` updated many times → store latest per id, never double-count).

**Files:** Create `src/data/event-reducer.ts`; Test `tests/data/event-reducer.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { reduce } from '../../src/data/event-reducer';
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/data/event-reducer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { OpencodeState, MsgAgg } from '../types/index.js';
import { zeroTokens } from '../types/index.js';

export function reduce(state: OpencodeState, event: any): OpencodeState {
  const type: string = event?.type;
  if (type === 'message.updated') {
    const info = event.properties?.info;
    if (!info || info.role !== 'assistant') return { ...state, idle: false, lastUpdate: Date.now() };
    const t = info.tokens ?? {};
    const cache = t.cache ?? {};
    const agg: MsgAgg = {
      role: 'assistant',
      cost: typeof info.cost === 'number' ? info.cost : 0,
      tokens: {
        input: t.input ?? 0, output: t.output ?? 0, reasoning: t.reasoning ?? 0,
        cacheRead: cache.read ?? 0, cacheWrite: cache.write ?? 0,
      },
      modelID: info.modelID, providerID: info.providerID, mode: info.mode,
      cwd: info.path?.cwd, created: info.time?.created ?? Date.now(),
    };
    const byMessage = { ...state.byMessage, [info.id]: agg };
    const sessionStart = state.sessionStart === null ? agg.created : Math.min(state.sessionStart, agg.created);
    return { ...state, byMessage, latestAssistantID: info.id, sessionStart, idle: false, lastUpdate: Date.now() };
  }
  if (type === 'session.idle') return { ...state, idle: true, lastUpdate: Date.now() };
  if (type === 'session.error') return { ...state, idle: true, lastUpdate: Date.now() };
  return state;
}

export { zeroTokens };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/data/event-reducer.test.ts`
Expected: PASS (5).

- [ ] **Step 5: Commit**

```bash
git add src/data/event-reducer.ts tests/data/event-reducer.test.ts
git commit -m "feat(data): event reducer with streaming dedupe"
```

---

## Task 5: Selectors (derive display values)

**Files:** Create `src/data/selectors.ts`; Test `tests/data/selectors.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/data/selectors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { OpencodeState, Derived } from '../types/index.js';

export type LimitLookup = (provider: string | null, model: string | null) => number | null;

export function derive(state: OpencodeState, getLimit: LimitLookup, now: number): Derived {
  const latest = state.latestAssistantID ? state.byMessage[state.latestAssistantID] : undefined;
  const model = latest?.modelID ?? null;
  const provider = latest?.providerID ?? null;
  const mode = latest?.mode ?? null;
  const cwd = latest?.cwd ?? null;

  let cost = 0, totalTokens = 0;
  for (const id of Object.keys(state.byMessage)) {
    const m = state.byMessage[id];
    cost += m.cost;
    totalTokens += m.tokens.input + m.tokens.output + m.tokens.reasoning;
  }
  const contextTokens = latest ? latest.tokens.input + latest.tokens.cacheRead + latest.tokens.cacheWrite : 0;
  const contextLimit = getLimit(provider, model);
  const sessionDurationMs = state.sessionStart === null ? 0 : Math.max(0, now - state.sessionStart);

  return { model, provider, mode, cwd, totalTokens, contextTokens, contextLimit, cost, sessionDurationMs };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/data/selectors.test.ts`
Expected: PASS (4).

- [ ] **Step 5: Commit**

```bash
git add src/data/selectors.ts tests/data/selectors.test.ts
git commit -m "feat(data): selectors derive display values from state"
```

---

## Task 6: Model context-limit lookup

**Files:** Create `src/data/models.ts`; Test `tests/data/models.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/data/models.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
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
```

> Note: `~/.cache/opencode/models.json` confirmed to contain `"limit":{"context":N}` entries. If the real top-level shape differs (e.g. flat `provider/model` keys), adjust `buildLimitLookup` accordingly — verify by inspecting the file's first object during implementation.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/data/models.test.ts`
Expected: PASS (3).

- [ ] **Step 5: Commit**

```bash
git add src/data/models.ts tests/data/models.test.ts
git commit -m "feat(data): model context-limit lookup from models.json"
```

---

## Task 7: Git info

**Files:** Create `src/data/git.ts`; Test `tests/data/git.test.ts`.

- [ ] **Step 1: Write the failing test** (inject a fake exec so no real git needed)

```ts
import { describe, it, expect } from 'vitest';
import { parseGit } from '../../src/data/git';

describe('parseGit', () => {
  it('parses branch, dirty, ahead/behind, changes, sha from porcelain v2', () => {
    const out = [
      '# branch.oid abcdef1234567890',
      '# branch.head main',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 aaa bbb file1.ts',
      '? untracked.ts',
    ].join('\n');
    const g = parseGit(out);
    expect(g.isRepo).toBe(true);
    expect(g.branch).toBe('main');
    expect(g.ahead).toBe(2);
    expect(g.behind).toBe(1);
    expect(g.changes).toBe(2); // one modified + one untracked
    expect(g.dirty).toBe(true);
    expect(g.sha).toBe('abcdef1');
  });
  it('clean repo: dirty false, changes 0', () => {
    const out = ['# branch.oid abcdef1234567890', '# branch.head main', '# branch.ab +0 -0'].join('\n');
    const g = parseGit(out);
    expect(g.dirty).toBe(false);
    expect(g.changes).toBe(0);
  });
  it('empty output → not a repo', () => {
    expect(parseGit('').isRepo).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/data/git.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { execFileSync } from 'child_process';
import type { GitInfo } from '../types/index.js';

export function parseGit(porcelain: string): GitInfo {
  const lines = porcelain.split('\n').filter(Boolean);
  if (lines.length === 0) return { isRepo: false, branch: null, dirty: false, ahead: 0, behind: 0, changes: 0, sha: null };
  let branch: string | null = null, sha: string | null = null, ahead = 0, behind = 0, changes = 0;
  for (const line of lines) {
    if (line.startsWith('# branch.head ')) branch = line.slice('# branch.head '.length).trim();
    else if (line.startsWith('# branch.oid ')) sha = line.slice('# branch.oid '.length).trim().slice(0, 7);
    else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+)\s+-(\d+)/);
      if (m) { ahead = parseInt(m[1]); behind = parseInt(m[2]); }
    } else if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('? ') || line.startsWith('u ')) {
      changes++;
    }
  }
  if (branch === '(detached)') branch = sha;
  return { isRepo: true, branch, dirty: changes > 0, ahead, behind, changes, sha };
}

export function getGitInfo(cwd: string | null): GitInfo {
  const empty: GitInfo = { isRepo: false, branch: null, dirty: false, ahead: 0, behind: 0, changes: 0, sha: null };
  if (!cwd) return empty;
  try {
    const out = execFileSync('git', ['status', '--porcelain=v2', '--branch', '--untracked-files=all'],
      { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    return parseGit(out);
  } catch {
    return empty;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/data/git.test.ts`
Expected: PASS (3).

- [ ] **Step 5: Commit**

```bash
git add src/data/git.ts tests/data/git.test.ts
git commit -m "feat(data): git info via porcelain v2"
```

---

## Task 8: ANSI + colors

**Files:** Create `src/render/ansi.ts`, `src/render/colors.ts`; Test `tests/render/colors.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { colorize } from '../../src/render/colors';

describe('colorize', () => {
  it('wraps text in SGR and resets', () => {
    const out = colorize('hi', { color: 'red' }, 'ansi16');
    expect(out.startsWith('\x1b[')).toBe(true);
    expect(out.endsWith('\x1b[0m')).toBe(true);
    expect(out).toContain('hi');
  });
  it('applies bold', () => {
    expect(colorize('x', { color: 'red', bold: true }, 'ansi16')).toContain('1;');
  });
  it('truecolor uses 38;2;r;g;b for hex', () => {
    expect(colorize('x', { color: '#10203f' }, 'truecolor')).toContain('38;2;16;32;63');
  });
  it('no color → returns text unchanged', () => {
    expect(colorize('plain', {}, 'truecolor')).toBe('plain');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/render/colors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/render/ansi.ts`**

```ts
export const RESET = '\x1b[0m';
export function sgr(codes: (string | number)[]): string { return `\x1b[${codes.join(';')}m`; }
// Strip ANSI for width calculations
export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}
```

- [ ] **Step 4: Implement `src/render/colors.ts`**

```ts
import { sgr, RESET } from './ansi.js';
import type { ColorLevel } from '../types/index.js';

const NAMED: Record<string, number> = {
  black: 0, red: 1, green: 2, yellow: 3, blue: 4, magenta: 5, cyan: 6, white: 7,
};

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function colorize(text: string, opts: { color?: string; bold?: boolean }, level: ColorLevel): string {
  const codes: (string | number)[] = [];
  if (opts.bold) codes.push(1);
  if (opts.color) {
    const rgb = hexToRgb(opts.color);
    if (rgb && level === 'truecolor') codes.push(38, 2, rgb[0], rgb[1], rgb[2]);
    else if (NAMED[opts.color] !== undefined) codes.push(30 + NAMED[opts.color]);
    else if (rgb) codes.push(30 + 7); // fallback white-ish for hex on low-color terms
  }
  if (codes.length === 0) return text;
  return sgr(codes) + text + RESET;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/render/colors.test.ts`
Expected: PASS (4).

- [ ] **Step 6: Commit**

```bash
git add src/render/ansi.ts src/render/colors.ts tests/render/colors.test.ts
git commit -m "feat(render): ANSI + color helpers"
```

---

## Task 9: Widget registry + info/token/cost/context/git/custom widgets

Each widget is small. Group into one task with complete code and grouped tests.

**Files:** Create `src/widgets/index.ts` and the widget modules; Test `tests/widgets/widgets.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { WIDGETS } from '../../src/widgets/index';
import type { RenderContext } from '../../src/types/index';
import { emptyState } from '../../src/types/index';

function ctx(over: Partial<RenderContext> = {}): RenderContext {
  return {
    state: emptyState(),
    derived: { model: 'qwen3-coder', provider: 'ollama', mode: 'build', cwd: '/home/u/proj',
      totalTokens: 1234, contextTokens: 6553, contextLimit: 65536, cost: 0.042, sessionDurationMs: 192000 },
    git: { isRepo: true, branch: 'main', dirty: true, ahead: 2, behind: 0, changes: 3, sha: 'abcdef1' },
    termWidth: 120, now: 0, ...over,
  };
}

describe('widgets', () => {
  it('model strips context suffix', () => {
    expect(WIDGETS['model'].render(ctx(), { type: 'model' })).toBe('qwen3-coder');
  });
  it('provider and mode', () => {
    expect(WIDGETS['provider'].render(ctx(), { type: 'provider' })).toBe('ollama');
    expect(WIDGETS['mode'].render(ctx(), { type: 'mode' })).toBe('build');
  });
  it('cost formats USD', () => {
    expect(WIDGETS['cost'].render(ctx(), { type: 'cost' })).toBe('$0.04');
  });
  it('context-percentage', () => {
    expect(WIDGETS['context-percentage'].render(ctx(), { type: 'context-percentage' })).toBe('ctx 10%');
  });
  it('context-percentage hidden when no limit', () => {
    const c = ctx(); c.derived.contextLimit = null;
    expect(WIDGETS['context-percentage'].render(c, { type: 'context-percentage' })).toBeNull();
  });
  it('session-timer formats m:ss', () => {
    expect(WIDGETS['session-timer'].render(ctx(), { type: 'session-timer' })).toBe('3m12s');
  });
  it('git-branch shows branch with dirty marker', () => {
    expect(WIDGETS['git-branch'].render(ctx(), { type: 'git-branch' })).toBe('main*');
  });
  it('git-branch hidden outside repo', () => {
    const c = ctx(); c.git.isRepo = false;
    expect(WIDGETS['git-branch'].render(c, { type: 'git-branch' })).toBeNull();
  });
  it('git-ahead-behind', () => {
    expect(WIDGETS['git-ahead-behind'].render(ctx(), { type: 'git-ahead-behind' })).toBe('↑2');
  });
  it('cwd basename', () => {
    expect(WIDGETS['cwd'].render(ctx(), { type: 'cwd' })).toBe('proj');
  });
  it('tokens total formats k', () => {
    expect(WIDGETS['tokens'].render(ctx(), { type: 'tokens' })).toBe('1.2k');
  });
  it('custom-text echoes its text', () => {
    expect(WIDGETS['custom-text'].render(ctx(), { type: 'custom-text', text: 'hi' })).toBe('hi');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/widgets/widgets.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement helpers + widgets in `src/widgets/index.ts`**

```ts
import * as path from 'path';
import type { Widget, RenderContext, WidgetConfig } from '../types/index.js';

function fmtK(n: number): string {
  if (n < 1000) return String(n);
  return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
}
function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 60) return `${m}m${String(sec).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h${String(m % 60).padStart(2, '0')}m`;
}

const widgets: Widget[] = [
  { type: 'model', label: 'Model', render: (c) => c.derived.model ? c.derived.model.replace(/\s*\(.*context\)$/i, '') : null },
  { type: 'provider', label: 'Provider', render: (c) => c.derived.provider },
  { type: 'mode', label: 'Agent/Mode', render: (c) => c.derived.mode },
  { type: 'cost', label: 'Cost', render: (c) => c.derived.cost > 0 ? `$${c.derived.cost.toFixed(2)}` : '$0.00' },
  { type: 'tokens', label: 'Tokens (total)', render: (c) => fmtK(c.derived.totalTokens) },
  { type: 'context-length', label: 'Context Length', render: (c) => fmtK(c.derived.contextTokens) },
  {
    type: 'context-percentage', label: 'Context %',
    render: (c) => c.derived.contextLimit ? `ctx ${Math.round((c.derived.contextTokens / c.derived.contextLimit) * 100)}%` : null,
  },
  {
    type: 'context-bar', label: 'Context Bar',
    render: (c) => {
      if (!c.derived.contextLimit) return null;
      const pct = Math.min(1, c.derived.contextTokens / c.derived.contextLimit);
      const width = 10;
      const filled = Math.round(pct * width);
      return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
    },
  },
  { type: 'context-window', label: 'Context Window', render: (c) => c.derived.contextLimit ? fmtK(c.derived.contextLimit) : null },
  { type: 'session-timer', label: 'Session Timer', render: (c) => c.derived.sessionDurationMs > 0 ? fmtDuration(c.derived.sessionDurationMs) : null },
  { type: 'git-branch', label: 'Git Branch', render: (c) => c.git.isRepo && c.git.branch ? c.git.branch + (c.git.dirty ? '*' : '') : null },
  { type: 'git-clean-status', label: 'Git Clean Status', render: (c) => c.git.isRepo ? (c.git.dirty ? 'dirty' : 'clean') : null },
  {
    type: 'git-ahead-behind', label: 'Git Ahead/Behind',
    render: (c) => {
      if (!c.git.isRepo) return null;
      const parts: string[] = [];
      if (c.git.ahead) parts.push(`↑${c.git.ahead}`);
      if (c.git.behind) parts.push(`↓${c.git.behind}`);
      return parts.length ? parts.join(' ') : null;
    },
  },
  { type: 'git-changes', label: 'Git Changes', render: (c) => c.git.isRepo && c.git.changes ? `±${c.git.changes}` : null },
  { type: 'git-sha', label: 'Git SHA', render: (c) => c.git.isRepo ? c.git.sha : null },
  { type: 'cwd', label: 'Working Dir', render: (c) => c.derived.cwd ? path.basename(c.derived.cwd) : null },
  { type: 'custom-text', label: 'Custom Text', render: (_c, cfg) => (typeof cfg.text === 'string' ? cfg.text : '') },
  { type: 'custom-symbol', label: 'Custom Symbol', render: (_c, cfg) => (typeof cfg.symbol === 'string' ? cfg.symbol : '') },
  // separator is handled by the renderer, but register a no-render placeholder
  { type: 'separator', label: 'Separator', render: () => null },
];

export const WIDGETS: Record<string, Widget> = Object.fromEntries(widgets.map((w) => [w.type, w]));
export { fmtK, fmtDuration };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/widgets/widgets.test.ts`
Expected: PASS (12).

- [ ] **Step 5: Commit**

```bash
git add src/widgets/index.ts tests/widgets/widgets.test.ts
git commit -m "feat(widgets): Phase 1 widget set + registry"
```

---

## Task 10: Flex / width fitting

**Files:** Create `src/render/flex.ts`; Test `tests/render/flex.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { fitWidth } from '../../src/render/flex';
import { stripAnsi } from '../../src/render/ansi';

describe('fitWidth', () => {
  it('returns line unchanged when it fits', () => {
    expect(fitWidth('abc def', 20)).toBe('abc def');
  });
  it('truncates with ellipsis when too wide', () => {
    const out = fitWidth('abcdefghij', 5);
    expect(stripAnsi(out).length).toBeLessThanOrEqual(5);
    expect(out.endsWith('…')).toBe(true);
  });
  it('measures visible width ignoring ANSI', () => {
    const colored = '\x1b[31mabc\x1b[0m';
    expect(fitWidth(colored, 10)).toBe(colored);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/render/flex.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { stripAnsi } from './ansi.js';

export function visibleWidth(s: string): number {
  return stripAnsi(s).length;
}

export function fitWidth(line: string, max: number): string {
  if (visibleWidth(line) <= max) return line;
  // Truncate on the visible (stripped) text; drop ANSI to keep it simple/correct.
  const plain = stripAnsi(line);
  if (max <= 1) return '…'.slice(0, Math.max(0, max));
  return plain.slice(0, max - 1) + '…';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/render/flex.test.ts`
Expected: PASS (3).

- [ ] **Step 5: Commit**

```bash
git add src/render/flex.ts tests/render/flex.test.ts
git commit -m "feat(render): width fitting / truncation"
```

---

## Task 11: Powerline rendering

**Files:** Create `src/render/powerline.ts`; Test `tests/render/powerline.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { joinPowerline, joinPlain } from '../../src/render/powerline';

describe('powerline/join', () => {
  it('joinPlain inserts separators between non-empty segments', () => {
    expect(joinPlain(['a', '', 'b'], ' | ')).toBe('a | b');
  });
  it('joinPlain collapses around empty segments (no dangling separators)', () => {
    expect(joinPlain(['', 'a', '', '', 'b', ''], ' ')).toBe('a b');
  });
  it('joinPowerline places the separator glyph between segments', () => {
    const out = joinPowerline(['a', 'b'], '');
    expect(out).toContain('a');
    expect(out).toContain('');
    expect(out).toContain('b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/render/powerline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
export function joinPlain(segments: string[], separator: string): string {
  return segments.filter((s) => s && s.length > 0).join(separator);
}

// Phase 1 Powerline: glue segments with the separator glyph. (Per-segment
// fg/bg color transitions are a Plan 1B / later refinement.)
export function joinPowerline(segments: string[], separatorGlyph: string): string {
  return segments.filter((s) => s && s.length > 0).join(separatorGlyph);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/render/powerline.test.ts`
Expected: PASS (3).

- [ ] **Step 5: Commit**

```bash
git add src/render/powerline.ts tests/render/powerline.test.ts
git commit -m "feat(render): powerline/plain segment joining"
```

---

## Task 12: Renderer (compose lines)

**Files:** Create `src/render/renderer.ts`; Test `tests/render/renderer.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { renderLines } from '../../src/render/renderer';
import type { RenderContext, Settings } from '../../src/types/index';
import { emptyState } from '../../src/types/index';
import { stripAnsi } from '../../src/render/ansi';

function ctx(): RenderContext {
  return {
    state: emptyState(),
    derived: { model: 'qwen3-coder', provider: 'ollama', mode: 'build', cwd: '/p/proj',
      totalTokens: 0, contextTokens: 6553, contextLimit: 65536, cost: 0.04, sessionDurationMs: 192000 },
    git: { isRepo: true, branch: 'main', dirty: false, ahead: 0, behind: 0, changes: 0, sha: 'abc1234' },
    termWidth: 200, now: 0,
  };
}
const settings: Settings = {
  refreshInterval: 1000, colorLevel: 'ansi16',
  powerline: { enabled: false, separator: '|', separatorReverse: '|' },
  lines: [[
    { type: 'model', color: 'cyan' }, { type: 'separator' },
    { type: 'git-branch' }, { type: 'separator' },
    { type: 'context-percentage' }, { type: 'separator' }, { type: 'cost' },
  ]],
};

describe('renderLines', () => {
  it('renders a single line with separators, hidden widgets collapsed', () => {
    const [line] = renderLines(ctx(), settings);
    expect(stripAnsi(line)).toBe('qwen3-coder · main · ctx 10% · $0.04');
  });
  it('omits empty widgets and their separators', () => {
    const c = ctx(); c.git.isRepo = false; // git-branch hidden
    const [line] = renderLines(c, settings);
    expect(stripAnsi(line)).toBe('qwen3-coder · ctx 10% · $0.04');
  });
  it('fits to terminal width', () => {
    const c = ctx(); c.termWidth = 12;
    const [line] = renderLines(c, settings);
    expect(stripAnsi(line).length).toBeLessThanOrEqual(12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/render/renderer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { RenderContext, Settings, WidgetConfig } from '../types/index.js';
import { WIDGETS } from '../widgets/index.js';
import { colorize } from './colors.js';
import { joinPlain, joinPowerline } from './powerline.js';
import { fitWidth } from './flex.js';

const DEFAULT_SEP = ' · ';

function renderWidget(ctx: RenderContext, cfg: WidgetConfig, settings: Settings): string | null {
  const w = WIDGETS[cfg.type];
  if (!w) return null;
  const raw = w.render(ctx, cfg);
  if (raw === null || raw === '') return null;
  return colorize(raw, { color: cfg.color, bold: cfg.bold }, settings.colorLevel);
}

export function renderLine(ctx: RenderContext, line: WidgetConfig[], settings: Settings): string {
  // Split on explicit separator widgets into groups, render each group's widgets,
  // then join non-empty rendered widgets with the active separator.
  const rendered: string[] = [];
  for (const cfg of line) {
    if (cfg.type === 'separator') continue; // separators are implicit between widgets
    const out = renderWidget(ctx, cfg, settings);
    if (out) rendered.push(out);
  }
  const joined = settings.powerline.enabled
    ? joinPowerline(rendered, settings.powerline.separator)
    : joinPlain(rendered, DEFAULT_SEP);
  return fitWidth(joined, ctx.termWidth);
}

export function renderLines(ctx: RenderContext, settings: Settings): string[] {
  return settings.lines.map((line) => renderLine(ctx, line, settings));
}
```

> Design note: explicit `separator` widgets in the config act as *visual intent markers*; the renderer joins all non-empty widgets with a single active separator and collapses gaps, which satisfies the "no dangling separators" requirement. (Per-position custom separators are a later refinement.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/render/renderer.test.ts`
Expected: PASS (3).

- [ ] **Step 5: Commit**

```bash
git add src/render/renderer.ts tests/render/renderer.test.ts
git commit -m "feat(render): compose status lines from settings + widgets"
```

---

## Task 13: Server connection + event subscription

No unit test (network/process). Provide a thin, typed module and a manual check.

**Files:** Create `src/data/server.ts`.

- [ ] **Step 1: Implement**

```ts
import { createOpencode, createOpencodeClient } from '@opencode-ai/sdk';

export interface Conn {
  client: ReturnType<typeof createOpencodeClient>;
  serverUrl: string;
  close(): void;
}

/**
 * Connect to OpenCode. If `serverUrl` is given, attach to that running server.
 * Otherwise spawn and manage our own `opencode serve` via createOpencode().
 */
export async function connect(serverUrl?: string): Promise<Conn> {
  if (serverUrl) {
    const client = createOpencodeClient({ baseUrl: serverUrl } as any);
    return { client, serverUrl, close() {} };
  }
  const { client, server } = await createOpencode();
  return { client, serverUrl: server.url, close: () => server.close() };
}

/**
 * Subscribe to the OpenCode event stream and invoke onEvent for each event.
 * Returns a stop() function.
 */
export async function subscribeEvents(
  client: ReturnType<typeof createOpencodeClient>,
  onEvent: (event: any) => void,
): Promise<() => void> {
  const result: any = await (client as any).event.subscribe();
  let stopped = false;
  // ServerSentEventsResult: iterate its async stream. Property is `.stream`
  // (an async iterable of events). Verify the exact field against the SDK's
  // ServerSentEventsResult type during implementation if iteration fails.
  const stream = result.stream ?? result;
  (async () => {
    try {
      for await (const ev of stream) {
        if (stopped) break;
        onEvent(ev);
      }
    } catch {
      /* stream ended/aborted */
    }
  })();
  return () => { stopped = true; };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (If the SDK's `event.subscribe`/SSE iteration shape differs, adjust `subscribeEvents` per the `ServerSentEventsResult` type — this is the one place to verify against the live SDK.)

- [ ] **Step 3: Commit**

```bash
git add src/data/server.ts
git commit -m "feat(data): OpenCode server connect + event subscription"
```

---

## Task 14: Daemon entry (render loop) + CLI

**Files:** Create `src/index.ts`.

- [ ] **Step 1: Implement**

```ts
#!/usr/bin/env node
import { connect, subscribeEvents } from './data/server.js';
import { reduce } from './data/event-reducer.js';
import { derive } from './data/selectors.js';
import { loadLimitLookup } from './data/models.js';
import { getGitInfo } from './data/git.js';
import { renderLines } from './render/renderer.js';
import { loadSettings } from './utils/config.js';
import { emptyState, type OpencodeState, type RenderContext } from './types/index.js';

function getArg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 && i < process.argv.length - 1 ? process.argv[i + 1] : undefined;
}

function paint(state: OpencodeState, settings: ReturnType<typeof loadSettings>, getLimit: ReturnType<typeof loadLimitLookup>) {
  const now = Date.now();
  const derived = derive(state, getLimit, now);
  const git = getGitInfo(derived.cwd);
  const termWidth = process.stdout.columns || 120;
  const ctx: RenderContext = { state, derived, git, termWidth, now };
  const lines = renderLines(ctx, settings);
  // Repaint: move cursor to column 0, clear line(s), print.
  process.stdout.write('\r\x1b[2K' + lines.join('\n'));
}

async function main() {
  const settings = loadSettings();
  const getLimit = loadLimitLookup();
  const serverUrl = getArg('--server');
  let state = emptyState();

  const conn = await connect(serverUrl);
  if (!serverUrl) {
    process.stderr.write(`ocstatusline: managed server at ${conn.serverUrl}\n`);
    process.stderr.write(`  attach your session with: opencode attach ${conn.serverUrl}\n`);
  }
  state = { ...state, connected: true };

  const stop = await subscribeEvents(conn.client, (ev) => {
    state = reduce(state, ev);
    paint(state, settings, getLimit);
  });

  const tick = setInterval(() => paint(state, settings, getLimit), settings.refreshInterval);
  paint(state, settings, getLimit);

  const shutdown = () => { clearInterval(tick); stop(); conn.close(); process.stdout.write('\n'); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => { process.stderr.write(`ocstatusline: ${e?.message ?? e}\n`); process.exit(1); });
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: no errors; `dist/index.js` emitted.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: live status-line daemon entry + CLI"
```

---

## Task 15: Full test run + manual acceptance

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: all suites pass (config, event-reducer, selectors, models, git, colors, widgets, flex, powerline, renderer).

- [ ] **Step 2: Manual acceptance (managed server)**

Run (terminal A): `npm run build && node dist/index.js`
- Note the printed `opencode attach <url>`.
Run (terminal B): `opencode attach <url>` and send a prompt that triggers tool use.
Expected in terminal A: the status line appears and updates live — model, git branch, context %, cost, session timer — and reflows on resize. If the model backend (e.g. Ollama) is offline, tokens/cost stay zero but model/git/timer still render; that's acceptable.

- [ ] **Step 3: Manual acceptance (attach mode)**

Run (terminal A): `opencode serve --port 4096`
Run (terminal B): `node dist/index.js --server http://127.0.0.1:4096`
Run (terminal C): `opencode attach http://127.0.0.1:4096`
Expected: terminal B's status line tracks the session in terminal C.

- [ ] **Step 4: Report results.** Do not claim success without observing Step 2 or 3. If the event iteration shape was wrong, fix `subscribeEvents` and re-run.

---

## Self-Review

**Spec coverage:**
- Standalone live daemon → Tasks 13, 14. ✓
- Data sources (SDK event stream, models.json ctx, git, cwd) → Tasks 4, 5, 6, 7, 13. ✓
- Widget engine + Phase-1 widget set (incl. new Provider/Mode) → Task 9. ✓
- Render engine (colors, powerline, flex, multi-line) → Tasks 8, 10, 11, 12. ✓
- Config (JSON file + defaults) → Task 3. ✓
- Stack (TS, Node+Bun, Vitest, SDK) → Task 1. ✓
- Server discovery (managed default + --server) → Tasks 13, 14. ✓
- Error handling (no server, missing models.json, no git, unknown events, narrow term) → Tasks 4/6/7/10/14 (graceful degradation paths). ✓
- Ink config TUI → **deliberately deferred to Plan 1B** (noted in handoff). 

**Placeholder scan:** No TBD/TODO. The two "verify against live SDK" notes (models.json shape in Task 6, SSE iteration in Task 13) are explicit verification steps with a concrete default, not placeholders — they exist because these are the only two shapes that can't be unit-asserted offline.

**Type consistency:** `reduce(state, event)` (Task 4) used in Tasks 5-test and 14. `derive(state, getLimit, now)` signature consistent across Tasks 5, 14 and `LimitLookup` from selectors used by models (Task 6). `RenderContext`/`Settings`/`WidgetConfig`/`Widget` from Task 2 used uniformly. `WIDGETS` registry keys match `defaultSettings()` widget types in Task 3 (`model`, `git-branch`, `context-percentage`, `cost`, `session-timer`, `separator`). `colorize(text, {color,bold}, level)` consistent (Tasks 8, 12). `fitWidth`, `joinPlain`/`joinPowerline`, `stripAnsi` consistent (Tasks 10, 11, 12).
