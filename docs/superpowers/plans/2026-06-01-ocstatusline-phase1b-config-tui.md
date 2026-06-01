# ocstatusline Phase 1B — Config TUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interactive Ink/React configuration TUI that visually edits `~/.config/ocstatusline/settings.json` (widget layout, per-widget colors/bold, custom text, Powerline, multi-line, global settings) with a live mock preview, then persists it — without touching the Phase 1A daemon/render core.

**Architecture:** A pure edit reducer (`tui/state.ts`) owns all editing logic and is unit-tested without rendering Ink. Thin Ink screens dispatch actions and render. The preview reuses 1A's `renderLines` with a mock `RenderContext`; the widget catalog derives from 1A's `WIDGETS`; persistence uses 1A's `loadSettings`/`saveSettings`. `index.ts` becomes a CLI dispatcher: no args → TUI, `start [--server]` → daemon (extracted to `daemon.ts`).

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Ink 7, React 19, Vitest, ink-testing-library 4. Node ≥22 (project runs 24).

**Spec:** `docs/superpowers/specs/2026-06-01-ocstatusline-phase1b-config-tui-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/cli.ts` | Pure `parseCli(argv)` → `{mode, serverUrl?}` |
| `src/daemon.ts` | `runDaemon({serverUrl?})` — the 1A daemon, relocated from `index.ts` |
| `src/index.ts` | Thin dispatcher: `parseCli` → TUI or daemon |
| `src/tui/state.ts` | `EditorState`, `Action`, `initialState`, pure `editorReducer` |
| `src/tui/preview-context.ts` | `mockContext()` → representative `RenderContext` |
| `src/tui/widget-catalog.ts` | `availableWidgets()` → `{type,label}[]` (excludes `separator`) |
| `src/tui/components.tsx` | Shared `List` + `TextPrompt` Ink components |
| `src/tui/app.tsx` | `<App>` — `useReducer`, screen routing |
| `src/tui/run.tsx` | `mountTui()` — load → render → save on exit; non-TTY guard |
| `src/tui/screens/MainMenu.tsx` | Action list |
| `src/tui/screens/Preview.tsx` | Renders `renderLines(mockContext(), draft)` |
| `src/tui/screens/ItemsEditor.tsx` | Add/remove/reorder widgets; enter color/custom-text |
| `src/tui/screens/ColorMenu.tsx` | Named color + hex; toggle bold |
| `src/tui/screens/LineSelector.tsx` | Multi-line: list/add/remove/select |
| `src/tui/screens/PowerlineSetup.tsx` | Toggle powerline + separator glyphs |
| `src/tui/screens/Settings.tsx` | refreshInterval, colorLevel |
| `tests/cli.test.ts` | `parseCli` |
| `tests/tui/state.test.ts` | `editorReducer` (the bulk) |
| `tests/tui/helpers.test.ts` | `mockContext` + `availableWidgets` |
| `tests/tui/app.smoke.test.tsx` | ink-testing-library smoke |

---

## Task 1: Dependencies + build config

**Files:** Modify `package.json`, `tsconfig.json`, `vitest.config.ts`.

- [ ] **Step 1: Install runtime + dev deps**

Run:
```bash
npm install ink@^7.0.5 react@^19.2.0
npm install -D @types/react@^19.2.0 ink-testing-library@^4.0.0
```
Expected: completes; `node_modules/ink`, `node_modules/react` present.

- [ ] **Step 2: Enable JSX in `tsconfig.json`**

Add `"jsx": "react-jsx"` to `compilerOptions` (keep all existing options). Result:
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
    "resolveJsonModule": true,
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Update `vitest.config.ts` for tsx + automatic JSX**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['tests/**/*.test.{ts,tsx}'] },
  esbuild: { jsx: 'automatic' },
});
```

- [ ] **Step 4: Verify existing build + tests still pass**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all 47 existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts
git commit -m "chore(tui): add Ink 7 + React 19 deps and JSX build config"
```

---

## Task 2: CLI dispatcher + daemon extraction

**Files:**
- Create: `src/cli.ts`, `tests/cli.test.ts`
- Create: `src/daemon.ts` (move daemon logic out of `index.ts`)
- Modify: `src/index.ts` (becomes dispatcher)

- [ ] **Step 1: Write the failing test** — `tests/cli.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { parseCli } from '../src/cli';

describe('parseCli', () => {
  it('no args → tui mode', () => {
    expect(parseCli([])).toEqual({ mode: 'tui' });
  });
  it('unknown subcommand → tui mode', () => {
    expect(parseCli(['wat'])).toEqual({ mode: 'tui' });
  });
  it('start → daemon mode, no server', () => {
    expect(parseCli(['start'])).toEqual({ mode: 'daemon', serverUrl: undefined });
  });
  it('start --server <url> → daemon mode with url', () => {
    expect(parseCli(['start', '--server', 'http://127.0.0.1:4096']))
      .toEqual({ mode: 'daemon', serverUrl: 'http://127.0.0.1:4096' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `src/cli.ts`

```ts
export interface CliCommand {
  mode: 'tui' | 'daemon';
  serverUrl?: string;
}

export function parseCli(argv: string[]): CliCommand {
  if (argv[0] === 'start') {
    const i = argv.indexOf('--server');
    const serverUrl = i >= 0 && i < argv.length - 1 ? argv[i + 1] : undefined;
    return { mode: 'daemon', serverUrl };
  }
  return { mode: 'tui' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli.test.ts`
Expected: PASS (4).

- [ ] **Step 5: Create `src/daemon.ts`** (move the daemon out of the current `src/index.ts` verbatim, wrapped in `runDaemon`)

```ts
import { connect, subscribeEvents } from './data/server.js';
import { reduce } from './data/event-reducer.js';
import { derive } from './data/selectors.js';
import { loadLimitLookup } from './data/models.js';
import { getGitInfo } from './data/git.js';
import { renderLines } from './render/renderer.js';
import { repaint } from './render/ansi.js';
import { loadSettings } from './utils/config.js';
import { emptyState, type OpencodeState, type RenderContext } from './types/index.js';

let prevLineCount = 0;

function paint(state: OpencodeState, settings: ReturnType<typeof loadSettings>, getLimit: ReturnType<typeof loadLimitLookup>) {
  const now = Date.now();
  const derived = derive(state, getLimit, now);
  const git = getGitInfo(derived.cwd);
  const termWidth = process.stdout.columns || 120;
  const ctx: RenderContext = { state, derived, git, termWidth, now };
  const lines = renderLines(ctx, settings);
  process.stdout.write(repaint(lines, prevLineCount));
  prevLineCount = lines.length;
}

export async function runDaemon(opts: { serverUrl?: string }): Promise<void> {
  const settings = loadSettings();
  const getLimit = loadLimitLookup();
  const serverUrl = opts.serverUrl;
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
```

- [ ] **Step 6: Replace `src/index.ts`** with the dispatcher (TUI branch is wired in Task 8)

```ts
#!/usr/bin/env node
import { parseCli } from './cli.js';
import { runDaemon } from './daemon.js';

async function main() {
  const cmd = parseCli(process.argv.slice(2));
  if (cmd.mode === 'daemon') {
    await runDaemon({ serverUrl: cmd.serverUrl });
    return;
  }
  // TUI mode is wired in Task 8.
  process.stderr.write('ocstatusline: config TUI not yet available; use "ocstatusline start"\n');
  process.exit(1);
}

main().catch((e) => { process.stderr.write(`ocstatusline: ${e?.message ?? e}\n`); process.exit(1); });
```

- [ ] **Step 7: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: clean; `dist/daemon.js`, `dist/cli.js`, `dist/index.js` emitted.

- [ ] **Step 8: Commit**

```bash
git add src/cli.ts tests/cli.test.ts src/daemon.ts src/index.ts
git commit -m "refactor(cli): dispatcher + extract daemon to daemon.ts"
```

---

## Task 3: Edit state reducer (the core)

**Files:** Create `src/tui/state.ts`; Test `tests/tui/state.test.ts`.

- [ ] **Step 1: Write the failing test** — `tests/tui/state.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { initialState, editorReducer } from '../../src/tui/state';
import { defaultSettings } from '../../src/utils/config';
import type { Settings } from '../../src/types/index';

function twoLine(): Settings {
  return {
    refreshInterval: 1000, colorLevel: 'truecolor',
    powerline: { enabled: false, separator: '', separatorReverse: '' },
    lines: [
      [{ type: 'model' }, { type: 'cost' }],
      [{ type: 'git-branch' }],
    ],
  };
}

describe('editorReducer', () => {
  it('initialState starts on menu, not dirty', () => {
    const s = initialState(defaultSettings());
    expect(s.screen).toBe('menu');
    expect(s.dirty).toBe(false);
    expect(s.lineIndex).toBe(0);
    expect(s.itemIndex).toBe(0);
  });
  it('nav changes screen and resets itemIndex, stays clean', () => {
    let s = editorReducer(initialState(defaultSettings()), { t: 'cursor', delta: 1, count: 5 });
    s = editorReducer(s, { t: 'nav', screen: 'items' });
    expect(s.screen).toBe('items');
    expect(s.itemIndex).toBe(0);
    expect(s.dirty).toBe(false);
  });
  it('cursor clamps within [0, count-1]', () => {
    let s = initialState(defaultSettings());
    s = editorReducer(s, { t: 'cursor', delta: -1, count: 3 });
    expect(s.itemIndex).toBe(0);
    s = editorReducer(s, { t: 'cursor', delta: 5, count: 3 });
    expect(s.itemIndex).toBe(2);
  });
  it('addItem appends to current line, selects it, marks dirty', () => {
    let s = initialState(twoLine());
    s = editorReducer(s, { t: 'addItem', widgetType: 'cwd' });
    expect(s.settings.lines[0].map(w => w.type)).toEqual(['model', 'cost', 'cwd']);
    expect(s.itemIndex).toBe(2);
    expect(s.dirty).toBe(true);
  });
  it('removeItem drops current widget and clamps cursor', () => {
    let s = { ...initialState(twoLine()), itemIndex: 1 };
    s = editorReducer(s, { t: 'removeItem' });
    expect(s.settings.lines[0].map(w => w.type)).toEqual(['model']);
    expect(s.itemIndex).toBe(0);
    expect(s.dirty).toBe(true);
  });
  it('moveItem reorders within the line and follows the item', () => {
    let s = initialState(twoLine()); // line0 = [model, cost], cursor 0
    s = editorReducer(s, { t: 'moveItem', delta: 1 });
    expect(s.settings.lines[0].map(w => w.type)).toEqual(['cost', 'model']);
    expect(s.itemIndex).toBe(1);
  });
  it('moveItem at boundary is a no-op', () => {
    let s = initialState(twoLine());
    s = editorReducer(s, { t: 'moveItem', delta: -1 });
    expect(s.settings.lines[0].map(w => w.type)).toEqual(['model', 'cost']);
    expect(s.itemIndex).toBe(0);
  });
  it('setColor and toggleBold mutate current widget', () => {
    let s = initialState(twoLine());
    s = editorReducer(s, { t: 'setColor', color: 'cyan' });
    s = editorReducer(s, { t: 'toggleBold' });
    expect(s.settings.lines[0][0].color).toBe('cyan');
    expect(s.settings.lines[0][0].bold).toBe(true);
    s = editorReducer(s, { t: 'setColor', color: undefined });
    expect(s.settings.lines[0][0].color).toBeUndefined();
  });
  it('setCustomText sets text on custom-text only', () => {
    let s = initialState({ ...twoLine(), lines: [[{ type: 'custom-text' }]] });
    s = editorReducer(s, { t: 'setCustomText', text: 'hi' });
    expect(s.settings.lines[0][0].text).toBe('hi');
  });
  it('setCustomText is a no-op for non-custom widgets', () => {
    let s = initialState(twoLine()); // model at 0
    s = editorReducer(s, { t: 'setCustomText', text: 'hi' });
    expect(s.settings.lines[0][0].text).toBeUndefined();
    expect(s.dirty).toBe(false);
  });
  it('addLine appends an empty line; removeLine keeps >= 1', () => {
    let s = initialState(twoLine());
    s = editorReducer(s, { t: 'addLine' });
    expect(s.settings.lines).toHaveLength(3);
    s = editorReducer(s, { t: 'removeLine' }); // removes current (line 0)
    expect(s.settings.lines).toHaveLength(2);
  });
  it('removeLine on the last remaining line is a no-op', () => {
    let s = initialState({ ...twoLine(), lines: [[{ type: 'model' }]] });
    s = editorReducer(s, { t: 'removeLine' });
    expect(s.settings.lines).toHaveLength(1);
    expect(s.dirty).toBe(false);
  });
  it('selectLine sets lineIndex and resets itemIndex', () => {
    let s = editorReducer(initialState(twoLine()), { t: 'selectLine', index: 1 });
    expect(s.lineIndex).toBe(1);
    expect(s.itemIndex).toBe(0);
  });
  it('togglePowerline and setSeparator', () => {
    let s = initialState(twoLine());
    s = editorReducer(s, { t: 'togglePowerline' });
    expect(s.settings.powerline.enabled).toBe(true);
    s = editorReducer(s, { t: 'setSeparator', which: 'sep', value: '>' });
    expect(s.settings.powerline.separator).toBe('>');
    s = editorReducer(s, { t: 'setSeparator', which: 'rev', value: '<' });
    expect(s.settings.powerline.separatorReverse).toBe('<');
  });
  it('setRefresh and setColorLevel', () => {
    let s = initialState(twoLine());
    s = editorReducer(s, { t: 'setRefresh', ms: 500 });
    s = editorReducer(s, { t: 'setColorLevel', level: 'ansi16' });
    expect(s.settings.refreshInterval).toBe(500);
    expect(s.settings.colorLevel).toBe('ansi16');
  });
  it('does not mutate the input state object', () => {
    const s0 = initialState(twoLine());
    const before = JSON.stringify(s0);
    editorReducer(s0, { t: 'addItem', widgetType: 'cwd' });
    expect(JSON.stringify(s0)).toBe(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui/state.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `src/tui/state.ts`

```ts
import type { Settings, WidgetConfig, ColorLevel } from '../types/index.js';

export type Screen = 'menu' | 'lines' | 'items' | 'color' | 'powerline' | 'settings' | 'preview';

export interface EditorState {
  settings: Settings;
  screen: Screen;
  lineIndex: number;
  itemIndex: number;
  dirty: boolean;
}

export type Action =
  | { t: 'nav'; screen: Screen }
  | { t: 'cursor'; delta: number; count: number }
  | { t: 'moveItem'; delta: number }
  | { t: 'addItem'; widgetType: string }
  | { t: 'removeItem' }
  | { t: 'setColor'; color?: string }
  | { t: 'toggleBold' }
  | { t: 'setCustomText'; text: string }
  | { t: 'addLine' }
  | { t: 'removeLine' }
  | { t: 'selectLine'; index: number }
  | { t: 'togglePowerline' }
  | { t: 'setSeparator'; which: 'sep' | 'rev'; value: string }
  | { t: 'setRefresh'; ms: number }
  | { t: 'setColorLevel'; level: ColorLevel };

export function initialState(settings: Settings): EditorState {
  return { settings, screen: 'menu', lineIndex: 0, itemIndex: 0, dirty: false };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(n, hi));

// Replace the current line's widget array immutably.
function patchLine(s: EditorState, fn: (line: WidgetConfig[]) => WidgetConfig[]): Settings {
  const lines = s.settings.lines.map((line, i) => (i === s.lineIndex ? fn(line) : line));
  return { ...s.settings, lines };
}

// Replace the current widget immutably.
function patchWidget(s: EditorState, fn: (w: WidgetConfig) => WidgetConfig): Settings {
  return patchLine(s, (line) => line.map((w, i) => (i === s.itemIndex ? fn(w) : w)));
}

export function editorReducer(s: EditorState, a: Action): EditorState {
  switch (a.t) {
    case 'nav':
      return { ...s, screen: a.screen, itemIndex: 0 };
    case 'cursor':
      return { ...s, itemIndex: clamp(s.itemIndex + a.delta, 0, Math.max(0, a.count - 1)) };
    case 'moveItem': {
      const line = s.settings.lines[s.lineIndex];
      const j = s.itemIndex + a.delta;
      if (j < 0 || j >= line.length) return s;
      const next = line.slice();
      [next[s.itemIndex], next[j]] = [next[j], next[s.itemIndex]];
      return { ...s, settings: patchLine(s, () => next), itemIndex: j, dirty: true };
    }
    case 'addItem': {
      const settings = patchLine(s, (line) => [...line, { type: a.widgetType }]);
      const len = settings.lines[s.lineIndex].length;
      return { ...s, settings, itemIndex: len - 1, dirty: true };
    }
    case 'removeItem': {
      const settings = patchLine(s, (line) => line.filter((_, i) => i !== s.itemIndex));
      const len = settings.lines[s.lineIndex].length;
      return { ...s, settings, itemIndex: clamp(s.itemIndex, 0, Math.max(0, len - 1)), dirty: true };
    }
    case 'setColor':
      return { ...s, settings: patchWidget(s, (w) => ({ ...w, color: a.color })), dirty: true };
    case 'toggleBold':
      return { ...s, settings: patchWidget(s, (w) => ({ ...w, bold: !w.bold })), dirty: true };
    case 'setCustomText': {
      const w = s.settings.lines[s.lineIndex]?.[s.itemIndex];
      if (!w || (w.type !== 'custom-text' && w.type !== 'custom-symbol')) return s;
      const key = w.type === 'custom-text' ? 'text' : 'symbol';
      return { ...s, settings: patchWidget(s, (cur) => ({ ...cur, [key]: a.text })), dirty: true };
    }
    case 'addLine':
      return { ...s, settings: { ...s.settings, lines: [...s.settings.lines, []] }, dirty: true };
    case 'removeLine': {
      if (s.settings.lines.length <= 1) return s;
      const lines = s.settings.lines.filter((_, i) => i !== s.lineIndex);
      return { ...s, settings: { ...s.settings, lines }, lineIndex: clamp(s.lineIndex, 0, lines.length - 1), itemIndex: 0, dirty: true };
    }
    case 'selectLine':
      return { ...s, lineIndex: clamp(a.index, 0, s.settings.lines.length - 1), itemIndex: 0 };
    case 'togglePowerline':
      return { ...s, settings: { ...s.settings, powerline: { ...s.settings.powerline, enabled: !s.settings.powerline.enabled } }, dirty: true };
    case 'setSeparator': {
      const key = a.which === 'sep' ? 'separator' : 'separatorReverse';
      return { ...s, settings: { ...s.settings, powerline: { ...s.settings.powerline, [key]: a.value } }, dirty: true };
    }
    case 'setRefresh':
      return { ...s, settings: { ...s.settings, refreshInterval: a.ms }, dirty: true };
    case 'setColorLevel':
      return { ...s, settings: { ...s.settings, colorLevel: a.level }, dirty: true };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tui/state.test.ts`
Expected: PASS (17).

- [ ] **Step 5: Commit**

```bash
git add src/tui/state.ts tests/tui/state.test.ts
git commit -m "feat(tui): pure edit state reducer"
```

---

## Task 4: Preview context + widget catalog

**Files:** Create `src/tui/preview-context.ts`, `src/tui/widget-catalog.ts`; Test `tests/tui/helpers.test.ts`.

- [ ] **Step 1: Write the failing test** — `tests/tui/helpers.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { mockContext } from '../../src/tui/preview-context';
import { availableWidgets } from '../../src/tui/widget-catalog';
import { renderLines } from '../../src/render/renderer';
import { defaultSettings } from '../../src/utils/config';
import { stripAnsi } from '../../src/render/ansi';

describe('mockContext', () => {
  it('renders the default settings to the representative line', () => {
    const [line] = renderLines(mockContext(), defaultSettings());
    expect(stripAnsi(line)).toBe('qwen3-coder · main* · ctx 42% · $0.12 · 3m12s');
  });
});

describe('availableWidgets', () => {
  it('includes real widgets and excludes the separator placeholder', () => {
    const types = availableWidgets().map(w => w.type);
    expect(types).toContain('model');
    expect(types).toContain('git-branch');
    expect(types).not.toContain('separator');
  });
  it('each entry has a non-empty label', () => {
    expect(availableWidgets().every(w => w.label.length > 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui/helpers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `src/tui/preview-context.ts`

```ts
import { emptyState, type RenderContext } from '../types/index.js';

// Representative sample data so the preview matches what the daemon would draw.
// contextTokens/contextLimit = 27525/65536 ≈ 42%; sessionDurationMs 192000 = 3m12s.
export function mockContext(): RenderContext {
  return {
    state: emptyState(),
    derived: {
      model: 'qwen3-coder', provider: 'ollama', mode: 'build', cwd: '/home/u/proj',
      totalTokens: 27575, contextTokens: 27525, contextLimit: 65536, cost: 0.12, sessionDurationMs: 192000,
    },
    git: { isRepo: true, branch: 'main', dirty: true, ahead: 0, behind: 0, changes: 3, sha: 'abc1234' },
    termWidth: 80,
    now: 0,
  };
}
```

- [ ] **Step 4: Implement** — `src/tui/widget-catalog.ts`

```ts
import { WIDGETS } from '../widgets/index.js';

export interface CatalogEntry { type: string; label: string; }

export function availableWidgets(): CatalogEntry[] {
  return Object.values(WIDGETS)
    .filter((w) => w.type !== 'separator')
    .map((w) => ({ type: w.type, label: w.label }));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/tui/helpers.test.ts`
Expected: PASS (3). If the default-line string differs, reconcile `mockContext` numbers with 1A's widget formatting (do NOT change 1A widgets).

- [ ] **Step 6: Commit**

```bash
git add src/tui/preview-context.ts src/tui/widget-catalog.ts tests/tui/helpers.test.ts
git commit -m "feat(tui): preview mock context + widget catalog"
```

---

## Task 5: Shared components + App shell + MainMenu + Preview + smoke test

**Files:** Create `src/tui/components.tsx`, `src/tui/app.tsx`, `src/tui/screens/MainMenu.tsx`, `src/tui/screens/Preview.tsx`; Test `tests/tui/app.smoke.test.tsx`.

- [ ] **Step 1: Implement shared components** — `src/tui/components.tsx`

```tsx
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export function List({ items, index }: { items: string[]; index: number }) {
  return (
    <Box flexDirection="column">
      {items.map((it, i) => (
        <Text key={i} color={i === index ? 'cyan' : undefined}>
          {(i === index ? '> ' : '  ') + it}
        </Text>
      ))}
    </Box>
  );
}

export function TextPrompt({ label, initial, onSubmit, onCancel }: {
  label: string; initial: string; onSubmit: (v: string) => void; onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  useInput((input, key) => {
    if (key.return) onSubmit(value);
    else if (key.escape) onCancel();
    else if (key.backspace || key.delete) setValue((v) => v.slice(0, -1));
    else if (input && !key.ctrl && !key.meta) setValue((v) => v + input);
  });
  return <Text>{label}: {value}<Text inverse> </Text></Text>;
}
```

- [ ] **Step 2: Implement MainMenu** — `src/tui/screens/MainMenu.tsx`

```tsx
import { Box, Text, useInput } from 'ink';
import { List } from '../components.js';
import type { EditorState, Action, Screen } from '../state.js';

const MENU: { label: string; screen?: Screen; save?: boolean }[] = [
  { label: 'Edit line items', screen: 'items' },
  { label: 'Colors', screen: 'items' },
  { label: 'Powerline setup', screen: 'powerline' },
  { label: 'Lines (add/remove)', screen: 'lines' },
  { label: 'Settings', screen: 'settings' },
  { label: 'Preview', screen: 'preview' },
  { label: 'Save & exit', save: true },
];

export function MainMenu({ state, dispatch, onSave, onExit }: {
  state: EditorState; dispatch: (a: Action) => void; onSave: () => void; onExit: () => void;
}) {
  useInput((input, key) => {
    if (key.upArrow) dispatch({ t: 'cursor', delta: -1, count: MENU.length });
    else if (key.downArrow) dispatch({ t: 'cursor', delta: 1, count: MENU.length });
    else if (key.return) {
      const item = MENU[state.itemIndex];
      if (item.screen) dispatch({ t: 'nav', screen: item.screen });
      else if (item.save) { onSave(); onExit(); }
    } else if (input === 'q') onExit();
  });
  return (
    <Box flexDirection="column">
      <Text bold>ocstatusline config{state.dirty ? ' *' : ''}</Text>
      <List items={MENU.map((m) => m.label)} index={state.itemIndex} />
      <Text dimColor>up/down move · Enter select · q quit</Text>
    </Box>
  );
}
```

- [ ] **Step 3: Implement Preview** — `src/tui/screens/Preview.tsx`

```tsx
import { Box, Text, useInput } from 'ink';
import { renderLines } from '../../render/renderer.js';
import { mockContext } from '../preview-context.js';
import type { EditorState, Action } from '../state.js';

export function Preview({ state, dispatch }: { state: EditorState; dispatch: (a: Action) => void }) {
  useInput((_input, key) => {
    if (key.escape || key.return) dispatch({ t: 'nav', screen: 'menu' });
  });
  const lines = renderLines(mockContext(), state.settings);
  return (
    <Box flexDirection="column">
      <Text bold>Preview (sample data)</Text>
      {lines.map((l, i) => <Text key={i}>{l}</Text>)}
      <Text dimColor>Esc back</Text>
    </Box>
  );
}
```

- [ ] **Step 4: Implement App shell** — `src/tui/app.tsx` (later tasks extend the switch)

```tsx
import { useReducer } from 'react';
import { Box, Text, useInput } from 'ink';
import { editorReducer, initialState, type EditorState, type Action } from './state.js';
import type { Settings } from '../types/index.js';
import { MainMenu } from './screens/MainMenu.js';
import { Preview } from './screens/Preview.js';

export interface AppProps {
  initialSettings: Settings;
  onSave: (s: Settings) => void;
  onExit: () => void;
}

function ComingSoon({ dispatch }: { dispatch: (a: Action) => void }) {
  useInput((_i, key) => { if (key.escape) dispatch({ t: 'nav', screen: 'menu' }); });
  return (
    <Box flexDirection="column">
      <Text>(screen coming soon)</Text>
      <Text dimColor>Esc back</Text>
    </Box>
  );
}

export function App({ initialSettings, onSave, onExit }: AppProps) {
  const [state, dispatch] = useReducer(editorReducer, initialSettings, initialState);
  switch (state.screen) {
    case 'menu':
      return <MainMenu state={state} dispatch={dispatch} onSave={() => onSave(state.settings)} onExit={onExit} />;
    case 'preview':
      return <Preview state={state} dispatch={dispatch} />;
    default:
      return <ComingSoon dispatch={dispatch} />;
  }
}
```

- [ ] **Step 5: Write the smoke test** — `tests/tui/app.smoke.test.tsx`

```tsx
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from '../../src/tui/app';
import { defaultSettings } from '../../src/utils/config';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('App smoke', () => {
  it('shows the main menu and opens the preview', async () => {
    const { lastFrame, stdin } = render(
      <App initialSettings={defaultSettings()} onSave={() => {}} onExit={() => {}} />,
    );
    await delay(30);
    expect(lastFrame()).toContain('ocstatusline config');
    expect(lastFrame()).toContain('Edit line items');
    for (let i = 0; i < 5; i++) { stdin.write('[B'); await delay(10); } // down to "Preview"
    stdin.write('\r'); await delay(30);                                      // enter
    expect(lastFrame()).toContain('qwen3-coder');
  });
});
```

- [ ] **Step 6: Run smoke + typecheck**

Run: `npx vitest run tests/tui/app.smoke.test.tsx && npm run typecheck`
Expected: smoke PASS (1); typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/tui/components.tsx src/tui/app.tsx src/tui/screens/MainMenu.tsx src/tui/screens/Preview.tsx tests/tui/app.smoke.test.tsx
git commit -m "feat(tui): app shell, main menu, preview + smoke test"
```

---

## Task 6: ItemsEditor + ColorMenu

**Files:** Create `src/tui/screens/ItemsEditor.tsx`, `src/tui/screens/ColorMenu.tsx`; Modify `src/tui/app.tsx` (add cases).

- [ ] **Step 1: Implement ItemsEditor** — `src/tui/screens/ItemsEditor.tsx`

```tsx
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { List, TextPrompt } from '../components.js';
import { availableWidgets } from '../widget-catalog.js';
import type { EditorState, Action } from '../state.js';

type Mode = 'list' | 'add' | 'text';

export function ItemsEditor({ state, dispatch }: { state: EditorState; dispatch: (a: Action) => void }) {
  const [mode, setMode] = useState<Mode>('list');
  const [addIndex, setAddIndex] = useState(0);
  const line = state.settings.lines[state.lineIndex] ?? [];
  const catalog = availableWidgets();

  useInput((input, key) => {
    if (mode !== 'list') return; // sub-modes own their input below
    if (key.escape) dispatch({ t: 'nav', screen: 'menu' });
    else if (key.upArrow) dispatch({ t: 'cursor', delta: -1, count: line.length });
    else if (key.downArrow) dispatch({ t: 'cursor', delta: 1, count: line.length });
    else if (input === '<') dispatch({ t: 'moveItem', delta: -1 });
    else if (input === '>') dispatch({ t: 'moveItem', delta: 1 });
    else if (input === 'd') dispatch({ t: 'removeItem' });
    else if (input === 'a') { setAddIndex(0); setMode('add'); }
    else if (input === 'e' || key.return) {
      const w = line[state.itemIndex];
      if (w && (w.type === 'custom-text' || w.type === 'custom-symbol')) setMode('text');
      else dispatch({ t: 'nav', screen: 'color' });
    }
  });

  if (mode === 'add') {
    return (
      <Box flexDirection="column">
        <Text bold>Add widget (Line {state.lineIndex + 1})</Text>
        <AddPicker
          catalog={catalog}
          index={addIndex}
          setIndex={setAddIndex}
          onPick={(type) => { dispatch({ t: 'addItem', widgetType: type }); setMode('list'); }}
          onCancel={() => setMode('list')}
        />
      </Box>
    );
  }
  if (mode === 'text') {
    const w = line[state.itemIndex];
    const initial = (typeof w?.text === 'string' ? w.text : typeof w?.symbol === 'string' ? w.symbol : '') as string;
    return (
      <Box flexDirection="column">
        <Text bold>Edit text</Text>
        <TextPrompt
          label="text"
          initial={initial}
          onSubmit={(v) => { dispatch({ t: 'setCustomText', text: v }); setMode('list'); }}
          onCancel={() => setMode('list')}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Line {state.lineIndex + 1} items</Text>
      <List items={line.length ? line.map((w) => w.type + (w.color ? ` [${w.color}]` : '') + (w.bold ? ' b' : '')) : ['(empty)']} index={state.itemIndex} />
      <Text dimColor>up/down · a add · d del · &lt;/&gt; move · e color/text · Esc back</Text>
    </Box>
  );
}

function AddPicker({ catalog, index, setIndex, onPick, onCancel }: {
  catalog: { type: string; label: string }[];
  index: number; setIndex: (n: number) => void;
  onPick: (type: string) => void; onCancel: () => void;
}) {
  useInput((_input, key) => {
    if (key.escape) onCancel();
    else if (key.upArrow) setIndex(Math.max(0, index - 1));
    else if (key.downArrow) setIndex(Math.min(catalog.length - 1, index + 1));
    else if (key.return) onPick(catalog[index].type);
  });
  return <List items={catalog.map((c) => `${c.label} (${c.type})`)} index={index} />;
}
```

- [ ] **Step 2: Implement ColorMenu** — `src/tui/screens/ColorMenu.tsx`

```tsx
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { List, TextPrompt } from '../components.js';
import type { EditorState, Action } from '../state.js';

const NAMED = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
const OPTIONS = ['(none)', ...NAMED, 'custom hex...'];

export function ColorMenu({ state, dispatch }: { state: EditorState; dispatch: (a: Action) => void }) {
  const [index, setIndex] = useState(0);
  const [hexMode, setHexMode] = useState(false);
  const [error, setError] = useState('');
  const w = state.settings.lines[state.lineIndex]?.[state.itemIndex];

  useInput((input, key) => {
    if (hexMode) return;
    if (key.escape) dispatch({ t: 'nav', screen: 'items' });
    else if (key.upArrow) setIndex(Math.max(0, index - 1));
    else if (key.downArrow) setIndex(Math.min(OPTIONS.length - 1, index + 1));
    else if (input === 'b') dispatch({ t: 'toggleBold' });
    else if (key.return) {
      const choice = OPTIONS[index];
      if (choice === '(none)') { dispatch({ t: 'setColor', color: undefined }); dispatch({ t: 'nav', screen: 'items' }); }
      else if (choice === 'custom hex...') { setError(''); setHexMode(true); }
      else { dispatch({ t: 'setColor', color: choice }); dispatch({ t: 'nav', screen: 'items' }); }
    }
  });

  if (hexMode) {
    return (
      <Box flexDirection="column">
        <Text bold>Hex color</Text>
        {error ? <Text color="red">{error}</Text> : null}
        <TextPrompt
          label="#rrggbb"
          initial=""
          onSubmit={(v) => {
            if (/^#?[0-9a-fA-F]{6}$/.test(v)) {
              dispatch({ t: 'setColor', color: v.startsWith('#') ? v : '#' + v });
              dispatch({ t: 'nav', screen: 'items' });
            } else { setError('invalid hex (expected #rrggbb)'); }
          }}
          onCancel={() => setHexMode(false)}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Color for {w ? w.type : '(no widget)'} {w?.bold ? '(bold)' : ''}</Text>
      <List items={OPTIONS} index={index} />
      <Text dimColor>up/down · Enter set · b toggle bold · Esc back</Text>
    </Box>
  );
}
```

- [ ] **Step 3: Wire cases into `src/tui/app.tsx`**

Add imports near the top:
```tsx
import { ItemsEditor } from './screens/ItemsEditor.js';
import { ColorMenu } from './screens/ColorMenu.js';
```
Add cases to the `switch` (before `default`):
```tsx
    case 'items':
      return <ItemsEditor state={state} dispatch={dispatch} />;
    case 'color':
      return <ColorMenu state={state} dispatch={dispatch} />;
```

- [ ] **Step 4: Typecheck + smoke**

Run: `npm run typecheck && npx vitest run tests/tui/app.smoke.test.tsx`
Expected: clean; smoke PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tui/screens/ItemsEditor.tsx src/tui/screens/ColorMenu.tsx src/tui/app.tsx
git commit -m "feat(tui): items editor + color menu"
```

---

## Task 7: LineSelector + PowerlineSetup + Settings

**Files:** Create `src/tui/screens/LineSelector.tsx`, `src/tui/screens/PowerlineSetup.tsx`, `src/tui/screens/Settings.tsx`; Modify `src/tui/app.tsx`.

- [ ] **Step 1: Implement LineSelector** — `src/tui/screens/LineSelector.tsx`

```tsx
import { Box, Text, useInput } from 'ink';
import { List } from '../components.js';
import type { EditorState, Action } from '../state.js';

export function LineSelector({ state, dispatch }: { state: EditorState; dispatch: (a: Action) => void }) {
  const lines = state.settings.lines;
  useInput((input, key) => {
    if (key.escape) dispatch({ t: 'nav', screen: 'menu' });
    else if (key.upArrow) dispatch({ t: 'selectLine', index: state.lineIndex - 1 });
    else if (key.downArrow) dispatch({ t: 'selectLine', index: state.lineIndex + 1 });
    else if (input === 'a') dispatch({ t: 'addLine' });
    else if (input === 'd') dispatch({ t: 'removeLine' });
    else if (key.return) dispatch({ t: 'nav', screen: 'items' });
  });
  const items = lines.map((line, i) => `Line ${i + 1}: ${line.map((w) => w.type).join(', ') || '(empty)'}`);
  return (
    <Box flexDirection="column">
      <Text bold>Lines</Text>
      <List items={items} index={state.lineIndex} />
      <Text dimColor>up/down select · a add · d remove · Enter edit items · Esc back</Text>
    </Box>
  );
}
```

> Note: this screen drives selection through `lineIndex` (via `selectLine`), not `itemIndex`, so `List` is given `index={state.lineIndex}`.

- [ ] **Step 2: Implement PowerlineSetup** — `src/tui/screens/PowerlineSetup.tsx`

```tsx
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { List, TextPrompt } from '../components.js';
import type { EditorState, Action } from '../state.js';

export function PowerlineSetup({ state, dispatch }: { state: EditorState; dispatch: (a: Action) => void }) {
  const [edit, setEdit] = useState<null | 'sep' | 'rev'>(null);
  const pl = state.settings.powerline;
  const rows = [
    `Powerline: ${pl.enabled ? 'on' : 'off'}`,
    `Separator: ${pl.separator || '(none)'}`,
    `Reverse:   ${pl.separatorReverse || '(none)'}`,
  ];

  useInput((_input, key) => {
    if (edit) return;
    if (key.escape) dispatch({ t: 'nav', screen: 'menu' });
    else if (key.upArrow) dispatch({ t: 'cursor', delta: -1, count: rows.length });
    else if (key.downArrow) dispatch({ t: 'cursor', delta: 1, count: rows.length });
    else if (key.return) {
      if (state.itemIndex === 0) dispatch({ t: 'togglePowerline' });
      else setEdit(state.itemIndex === 1 ? 'sep' : 'rev');
    }
  });

  if (edit) {
    return (
      <Box flexDirection="column">
        <Text bold>Set {edit === 'sep' ? 'separator' : 'reverse separator'} glyph</Text>
        <TextPrompt
          label="glyph"
          initial={edit === 'sep' ? pl.separator : pl.separatorReverse}
          onSubmit={(v) => { dispatch({ t: 'setSeparator', which: edit, value: v }); setEdit(null); }}
          onCancel={() => setEdit(null)}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Powerline setup</Text>
      <List items={rows} index={state.itemIndex} />
      <Text dimColor>up/down · Enter toggle/edit · Esc back</Text>
    </Box>
  );
}
```

- [ ] **Step 3: Implement Settings** — `src/tui/screens/Settings.tsx`

```tsx
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { List, TextPrompt } from '../components.js';
import type { ColorLevel } from '../../types/index.js';
import type { EditorState, Action } from '../state.js';

const LEVELS: ColorLevel[] = ['ansi16', 'ansi256', 'truecolor'];

export function SettingsScreen({ state, dispatch }: { state: EditorState; dispatch: (a: Action) => void }) {
  const [editRefresh, setEditRefresh] = useState(false);
  const { refreshInterval, colorLevel } = state.settings;
  const rows = [`Refresh interval (ms): ${refreshInterval}`, `Color level: ${colorLevel}`];

  useInput((_input, key) => {
    if (editRefresh) return;
    if (key.escape) dispatch({ t: 'nav', screen: 'menu' });
    else if (key.upArrow) dispatch({ t: 'cursor', delta: -1, count: rows.length });
    else if (key.downArrow) dispatch({ t: 'cursor', delta: 1, count: rows.length });
    else if (key.return) {
      if (state.itemIndex === 0) setEditRefresh(true);
      else {
        const next = LEVELS[(LEVELS.indexOf(colorLevel) + 1) % LEVELS.length];
        dispatch({ t: 'setColorLevel', level: next });
      }
    }
  });

  if (editRefresh) {
    return (
      <Box flexDirection="column">
        <Text bold>Refresh interval (ms)</Text>
        <TextPrompt
          label="ms"
          initial={String(refreshInterval)}
          onSubmit={(v) => { const n = parseInt(v, 10); if (Number.isFinite(n) && n > 0) dispatch({ t: 'setRefresh', ms: n }); setEditRefresh(false); }}
          onCancel={() => setEditRefresh(false)}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Settings</Text>
      <List items={rows} index={state.itemIndex} />
      <Text dimColor>up/down · Enter edit/cycle · Esc back</Text>
    </Box>
  );
}
```

- [ ] **Step 4: Wire cases into `src/tui/app.tsx`**

Add imports:
```tsx
import { LineSelector } from './screens/LineSelector.js';
import { PowerlineSetup } from './screens/PowerlineSetup.js';
import { SettingsScreen } from './screens/Settings.js';
```
Add cases (before `default`):
```tsx
    case 'lines':
      return <LineSelector state={state} dispatch={dispatch} />;
    case 'powerline':
      return <PowerlineSetup state={state} dispatch={dispatch} />;
    case 'settings':
      return <SettingsScreen state={state} dispatch={dispatch} />;
```
The `default` (`ComingSoon`) branch is now unreachable but harmless; leave it as a fallback.

- [ ] **Step 5: Typecheck + smoke**

Run: `npm run typecheck && npx vitest run tests/tui/app.smoke.test.tsx`
Expected: clean; smoke PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tui/screens/LineSelector.tsx src/tui/screens/PowerlineSetup.tsx src/tui/screens/Settings.tsx src/tui/app.tsx
git commit -m "feat(tui): line selector, powerline setup, settings screens"
```

---

## Task 8: Mount + dispatcher wiring + acceptance

**Files:** Create `src/tui/run.tsx`; Modify `src/index.ts`.

- [ ] **Step 1: Implement** — `src/tui/run.tsx`

```tsx
import { render } from 'ink';
import { loadSettings, saveSettings } from '../utils/config.js';
import { App } from './app.js';
import type { Settings } from '../types/index.js';

export async function mountTui(): Promise<void> {
  if (!process.stdin.isTTY) {
    process.stderr.write('ocstatusline: config TUI needs an interactive terminal. Run "ocstatusline start" to launch the daemon.\n');
    process.exit(0);
  }
  const initialSettings = loadSettings();
  const onSave = (s: Settings) => {
    try { saveSettings(s); }
    catch (e) { process.stderr.write(`ocstatusline: save failed: ${(e as Error).message}\n`); }
  };
  let inst: ReturnType<typeof render>;
  const onExit = () => inst.unmount();
  inst = render(<App initialSettings={initialSettings} onSave={onSave} onExit={onExit} />);
  await inst.waitUntilExit();
}
```

- [ ] **Step 2: Wire the TUI branch in `src/index.ts`**

Replace the interim TUI branch (the `process.stderr.write(... 'not yet available' ...)` + `process.exit(1)`) with a dynamic import so the daemon path never loads Ink:
```ts
async function main() {
  const cmd = parseCli(process.argv.slice(2));
  if (cmd.mode === 'daemon') {
    await runDaemon({ serverUrl: cmd.serverUrl });
    return;
  }
  const { mountTui } = await import('./tui/run.js');
  await mountTui();
}
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: clean; `dist/tui/run.js`, `dist/index.js` emitted.

- [ ] **Step 4: Full test run**

Run: `npm test`
Expected: all suites pass — 1A core (47) + `cli` (4) + `tui/state` (17) + `tui/helpers` (3) + `tui/app.smoke` (1).

- [ ] **Step 5: Manual acceptance**

1. Non-TTY guard: `echo "" | node dist/index.js` → prints the interactive-terminal hint and exits 0.
2. Daemon still works: `node dist/index.js start` → managed server line prints, status line paints; Ctrl-C exits. `node dist/index.js start --server http://127.0.0.1:4096` attaches if a server is running.
3. TUI (in a real terminal): `node dist/index.js` → main menu appears. Navigate to Lines → select line → Edit items → reorder/add/remove a widget → set a color → toggle Powerline → Settings (cycle color level) → Preview shows the edited line live → Save & exit.
4. Verify persistence: inspect `~/.config/ocstatusline/settings.json` reflects the edits; relaunch `node dist/index.js start` and confirm the daemon uses the new config.

- [ ] **Step 6: Report results.** Do not claim success without observing Step 4 (full `npm test`) and at least the non-TTY + daemon checks of Step 5. The interactive TUI walkthrough may be reported as "verified manually" only if actually run in a TTY; otherwise state that the smoke test + reducer tests cover the logic and the interactive walk was not executed.

- [ ] **Step 7: Commit**

```bash
git add src/tui/run.tsx src/index.ts
git commit -m "feat(tui): mount TUI + wire CLI dispatcher"
```

---

## Self-Review

**Spec coverage:**
- Invocation (`ocstatusline` → TUI, `start [--server]` → daemon) → Tasks 2, 8. ✓
- Pure edit reducer (all actions) → Task 3. ✓
- Static mock preview reusing `renderLines` → Tasks 4, 5. ✓
- Full editor screens (items/colors+hex/powerline/lines/settings/preview/save) → Tasks 5, 6, 7. ✓
- Widget catalog from `WIDGETS` excluding `separator` → Task 4. ✓
- Persistence via `loadSettings`/`saveSettings`, save-on-exit, write-error handling → Task 8. ✓
- Error handling: non-TTY guard (Task 8), invalid hex/refresh rejected at input (Tasks 6, 7), narrow-terminal via 1A `fitWidth` in preview (Task 4). ✓
- Architecture (pure reducer + thin Ink) → Tasks 3, 5–7. ✓
- Stack: Ink 7 / React 19 / ink-testing-library 4 / JSX build config → Task 1. ✓
- Testing: reducer (bulk), helpers integration, Ink smoke → Tasks 3, 4, 5. ✓
- Out-of-scope items (thinking-effort, compaction, daemon hardening) → not planned. ✓

**Placeholder scan:** No TBD/TODO. The interim `index.ts` message in Task 2 is real, working behavior that Task 8 replaces (incremental wiring), and the `ComingSoon` fallback in `app.tsx` becomes an unreachable safety default after Task 7 — neither is a plan placeholder.

**Type consistency:** `Action`/`EditorState`/`Screen` from Task 3 used uniformly by all screens (Tasks 5–7) and `app.tsx`. `cursor` always carries `{delta,count}`. `mockContext()`/`availableWidgets()` (Task 4) consumed by Preview (Task 5) and ItemsEditor (Task 6). `App` props `{initialSettings,onSave,onExit}` consistent across `app.tsx` (Task 5), the smoke test (Task 5), and `run.tsx` (Task 8). `runDaemon({serverUrl})`/`parseCli` (Task 2) consistent with `index.ts` (Tasks 2, 8). Screen component names match their `import`/`switch` usage (`SettingsScreen` exported and imported as such).
```
