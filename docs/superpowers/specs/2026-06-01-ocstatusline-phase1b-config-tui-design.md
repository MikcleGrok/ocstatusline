# ocstatusline Phase 1B — Config TUI Design

**Date:** 2026-06-01
**Goal:** Add the interactive **Ink/React configuration TUI** deliberately deferred from Phase 1A. It lets the user visually edit `~/.config/ocstatusline/settings.json` — the widget layout, per-widget colors/bold, custom text, Powerline, multi-line composition, and global settings — with a live preview, then persist it. The Phase 1A live daemon is unchanged; the TUI only edits the same `Settings` it already consumes.

**Relationship to 1A:** Phase 1A built the live daemon + the pure render/data core (42→47 unit tests, shipped). This phase reuses that core wholesale: the TUI's preview calls 1A's `renderLines`, the available widgets come from 1A's `WIDGETS` registry, and persistence uses 1A's `loadSettings`/`saveSettings`. No changes to the reducer/selectors/renderer/widgets are required.

**Spec (1A):** `docs/superpowers/specs/2026-06-01-ocstatusline-phase1-design.md`
**Plan (1A):** `docs/superpowers/plans/2026-06-01-ocstatusline-phase1a-live-core.md`

---

## Decisions (resolved during brainstorming)

1. **Invocation:** `ocstatusline` (no args) → **TUI** (config). `ocstatusline start [--server <url>]` → daemon. This matches the original 1A spec's intent and reconciles 1A's current behavior (where no-args launched the daemon).
2. **Preview data:** **static representative mock** `RenderContext` — configuring requires no running server; the preview re-renders instantly on every edit. (Mirrors ccstatusline.)
3. **Editor scope:** **full parity** — all screens (items editor, color menu incl. hex, Powerline setup, multi-line selector, global settings, preview, save).
4. **Architecture:** **pure edit reducer + thin Ink views** — mirrors 1A's pure-core / IO-at-edges philosophy; the reducer is unit-tested without rendering Ink.

---

## Architecture

```
src/
  daemon.ts          # NEW: the Phase 1A daemon, extracted verbatim from index.ts
                     #   runDaemon({ serverUrl?: string }): Promise<void>
  index.ts           # CHANGED: thin CLI dispatcher — argv → TUI | daemon
  tui/
    state.ts         # EditorState + Action + pure editorReducer + initialState(settings)
    app.tsx          # <App>: useReducer(editorReducer), screen routing, global keys
    run.ts           # mountTui(): load settings → render(<App/>) → save on exit
    preview-context.ts  # mockContext(): RenderContext (representative sample values)
    widget-catalog.ts    # availableWidgets(): {type,label}[] derived from WIDGETS
    screens/
      MainMenu.tsx       # action list (edit items / colors / powerline / lines / settings / preview / save & exit)
      LineSelector.tsx   # multi-line: list lines, add, remove, select one to edit
      ItemsEditor.tsx    # add / remove / reorder widgets on the selected line; enter color editing
      ColorMenu.tsx      # named color list + hex entry; toggle bold for the selected widget
      PowerlineSetup.tsx # toggle powerline; edit separator / separatorReverse glyphs
      Settings.tsx       # refreshInterval, colorLevel
      Preview.tsx        # renderLines(mockContext(), draft) — reuses 1A pipeline
tests/
  tui/state.test.ts      # bulk: pure reducer transitions (no Ink render)
  tui/preview.test.ts    # mockContext + renderLines → expected string
  tui/app.smoke.test.ts  # one ink-testing-library smoke (keystrokes → frame assertions)
```

### Component contracts

| Unit | Responsibility | Input → Output | Depends on |
|------|----------------|----------------|------------|
| `daemon.ts` | Run the live daemon (1A logic, relocated) | `{serverUrl?}` → runs until SIGINT | 1A data/render/server |
| `index.ts` | Route the CLI | `process.argv` → `mountTui()` or `runDaemon()` | tui/run, daemon |
| `tui/state.ts` | Own all edit logic, purely | `(EditorState, Action)` → `EditorState` | types only |
| `tui/preview-context.ts` | Provide sample render data | `()` → `RenderContext` | types only |
| `tui/widget-catalog.ts` | List addable widgets (derived from `WIDGETS`, excluding the implicit `separator` placeholder) | `()` → `{type,label}[]` | `WIDGETS` (1A) |
| `tui/app.tsx` | Route screens, hold state, global keys | mounts screens, dispatches | state, screens, ink |
| `tui/screens/*` | Render one screen, dispatch actions | `(state, dispatch)` → Ink tree | state, render (preview), ink |
| `tui/run.ts` | Mount/unmount lifecycle + persistence | `()` → side effects | config (1A), app, ink |

---

## Edit state model (pure)

```ts
import type { Settings, ColorLevel } from '../types/index.js';

export type Screen = 'menu' | 'lines' | 'items' | 'color' | 'powerline' | 'settings' | 'preview';

export interface EditorState {
  settings: Settings;   // working draft (Phase 1A Settings shape)
  screen: Screen;
  lineIndex: number;    // which line (settings.lines[lineIndex]) is being edited
  itemIndex: number;    // cursor within the current line's widgets, or within a menu list
  dirty: boolean;       // unsaved changes since load/last save
}

export type Action =
  | { t: 'nav'; screen: Screen }
  | { t: 'cursor'; delta: number }                 // move selection ±1 (clamped)
  | { t: 'moveItem'; delta: number }               // reorder current widget within its line
  | { t: 'addItem'; widgetType: string }           // append a widget to current line
  | { t: 'removeItem' }                            // remove current widget
  | { t: 'setColor'; color?: string }              // set/clear color of current widget
  | { t: 'toggleBold' }                            // toggle bold of current widget
  | { t: 'setCustomText'; text: string }           // set text/symbol for custom-* widgets
  | { t: 'addLine' }                               // append an empty line
  | { t: 'removeLine' }                            // remove current line (keep >= 1)
  | { t: 'selectLine'; index: number }
  | { t: 'togglePowerline' }
  | { t: 'setSeparator'; which: 'sep' | 'rev'; value: string }
  | { t: 'setRefresh'; ms: number }
  | { t: 'setColorLevel'; level: ColorLevel };

export function initialState(settings: Settings): EditorState;
export function editorReducer(state: EditorState, action: Action): EditorState; // immutable, pure
```

**Invariants enforced by the reducer:**
- `settings.lines` always has ≥ 1 line; `removeLine` on the last line is a no-op.
- `lineIndex`/`itemIndex` are clamped to valid ranges after any structural edit.
- Any action that changes `settings` sets `dirty: true`; pure navigation (`nav`, `cursor`) does not.
- All mutations are immutable (new objects), reusing 1A's discipline. `setCustomText` only applies when the current widget type is `custom-text`/`custom-symbol`.

---

## Screens & navigation

**Global keys:** `↑/↓` move cursor · `Enter` select / drill in · `Esc` or `←` back to menu · `q`/`Ctrl-C` quit (if `dirty`, confirm: save / discard / cancel).

- **MainMenu:** list → Edit line items · Colors · Powerline setup · Lines · Settings · Preview · Save & exit. `Enter` navigates (`nav`). Save & exit writes then unmounts.
- **LineSelector:** lists each line (index + a rendered summary); `a` add line, `d` remove line, `Enter` select → ItemsEditor.
- **ItemsEditor:** lists the current line's widgets; `↑/↓` select, `e`/`Enter` → ColorMenu for that widget, `a` → open widget-catalog picker (`addItem`), `d` → `removeItem`, `<`/`>` → `moveItem` ∓1. For a selected `custom-text`/`custom-symbol`, a text-input field edits its content (`setCustomText`).
- **ColorMenu:** named-color list (the 8 from 1A's palette) + a "custom hex…" entry that opens a `#rrggbb` text input; `b` toggles bold. Invalid hex is rejected with a message (no crash; 1A's `colorize` already ignores malformed hex).
- **PowerlineSetup:** `togglePowerline`; two text inputs for `separator` / `separatorReverse` glyphs.
- **Settings:** `refreshInterval` (ms, numeric input, must be > 0) and `colorLevel` (cycle `ansi16`/`ansi256`/`truecolor`).
- **Preview:** renders `renderLines(mockContext(), state.settings)` and prints the line(s) exactly as the daemon would. Reachable from the menu; the live draft is also shown as a footer on editing screens where space allows.

---

## Preview data

`mockContext()` returns a fixed, representative `RenderContext`:
- `derived`: model `qwen3-coder`, provider `ollama`, mode `build`, cwd `/home/u/proj`, `contextTokens` ≈ 42% of `contextLimit` (e.g. 27 525 / 65 536), `cost` 0.12, `totalTokens` 27 575, `sessionDurationMs` 192 000 (→ `3m12s`).
- `git`: isRepo true, branch `main`, dirty true, ahead 0/behind 0, changes 3, sha `abc1234`.
- `state`: `emptyState()`; `termWidth` 80; `now` 0.

The preview pipes this straight through 1A's `renderLines`, so what the user sees is byte-for-byte what the daemon produces for equivalent data.

---

## Error handling

- **Load:** `loadSettings()` already returns defaults on missing/corrupt config (1A) — TUI always starts editable.
- **Save:** `saveSettings(draft)` (creates the dir, writes JSON). On write failure, show an inline error and remain in the TUI rather than exiting.
- **Quit with unsaved changes:** confirm prompt (save / discard / cancel).
- **Non-TTY stdin:** if `process.stdin.isTTY` is falsy, the interactive TUI can't run — print a short hint (`run "ocstatusline start" to launch the daemon, or run the config in an interactive terminal`) and exit 0 (no crash).
- **Narrow terminal:** single-column layout; rely on Ink reflow. No fixed-width assumptions beyond the preview, which already truncates via 1A's `fitWidth`.
- **Invalid input:** non-numeric refresh / malformed hex are rejected at the input boundary with a message; the reducer never receives invalid values.

---

## Stack & dependencies

- Add runtime deps: `ink` (v5, ESM), `react` (v18). Dev: `@types/react`, `ink-testing-library`.
- Keep TypeScript ESM + `.js` import specifiers, strict mode, Node + Bun (consistent with 1A). `.tsx` files compile under the existing tsconfig (add `"jsx": "react-jsx"`).
- No new global config location; same `~/.config/ocstatusline/settings.json`.

---

## Testing

- **Unit (Vitest), the bulk — `tui/state.test.ts`:** exercise `editorReducer` for every action: navigation (`nav`/`cursor` clamping), `addItem`/`removeItem`/`moveItem` (incl. reorder at boundaries), `setColor`/`toggleBold`/`setCustomText` (incl. custom-only guard), `addLine`/`removeLine` (≥1 invariant)/`selectLine`, `togglePowerline`/`setSeparator`, `setRefresh`/`setColorLevel`, and the `dirty` flag semantics. Pure, no rendering.
- **Integration — `tui/preview.test.ts`:** `renderLines(mockContext(), defaultSettings())` (ANSI-stripped) equals the expected status line, proving the preview reuses the 1A pipeline correctly.
- **Smoke — `tui/app.smoke.test.ts`:** with `ink-testing-library`, mount `<App>`, send a few keystrokes (e.g. into Preview), assert the rendered frame contains expected menu items / preview text. One minimal test; Ink rendering is the IO edge.
- **Manual acceptance:** `ocstatusline` → reorder a widget, change a color, toggle Powerline, Save & exit → inspect `settings.json` → `ocstatusline start` reflects the new config. Confirm `ocstatusline start --server <url>` still attaches (1A path), and `ocstatusline` in a non-TTY prints the hint and exits 0.

---

## Out of scope (later phases)

Thinking-effort widget, compaction counter, Custom Command widget, advanced Powerline theme library / per-segment color transitions, update-checker, niche Git widgets, localizations. Daemon hardening items noted in the 1A final review (`--server` attach live-smoke, Windows `opencode serve` child cleanup on shutdown) are tracked separately and are not part of this TUI phase.
