# ocstatusline — Phase 1 Design

**Date:** 2026-06-01
**Goal:** Build `ocstatusline`, a highly customizable status-line tool for **OpenCode** (SST `opencode`, v1.2.6+) — the OpenCode counterpart of [ccstatusline](https://github.com/sirmalloc/ccstatusline) (which targets Claude Code). Full feature parity with ccstatusline is the long-term goal, delivered in phases. This spec covers **Phase 1: the functional core** (widget engine + live ANSI rendering + Powerline + config TUI + the OpenCode-relevant widget set).

Standalone project, unrelated to wmux. Lives in `Bureau/ocstatusline` (its own git repo).

## Background & Key Architectural Difference

ccstatusline works because **Claude Code reserves a status line and invokes ccstatusline as an external command**, passing a fixed JSON snapshot on stdin (model, tokens, context, cost, session, git) plus reading Claude's JSONL transcripts, `~/.claude.json`, and the Anthropic usage API. It installs itself into Claude's `settings.json` `statusLine` key.

**OpenCode has no equivalent.** Verified against the installed 1.2.6 binary and config schema: there is no `statusline` mechanism, no external-command hook for a persistent footer, and the TUI status bar is built-in and not pluggable. Therefore ocstatusline cannot be *invoked by* OpenCode the way ccstatusline is invoked by Claude.

**Chosen model (user-approved): a standalone live renderer ("daemon").** ocstatusline runs as its own process in its own terminal space (e.g. a split/pane), connects to an OpenCode server, subscribes to the live event stream, maintains in-memory state, and continuously repaints a status line. This is a *push* model (event-driven daemon) vs ccstatusline's *pull* model (one-shot per refresh). It reuses ~70% of ccstatusline's concepts (widget engine, Powerline, colors, flex-width, Ink config TUI); only the **data source** (Claude → OpenCode) and the **output mechanism** (settings.json statusLine → autonomous ANSI daemon) differ.

## Data sources (verified available)

- **Live session data:** OpenCode SDK `@opencode-ai/sdk` exposes `createOpencodeClient` + `event.subscribe()`. The event stream emits `message.updated` whose `properties.info` is a `Message`; an `AssistantMessage` carries `cost: number`, `tokens: {input, output, reasoning, cache:{read,write}}`, `modelID`, `providerID`, `mode`, `path:{cwd, root}`, `time:{created, completed}`. Also `session.idle`, `session.error`, `session.status`, `todo.updated`.
- **Context window size** (for context% / bar / window widgets): `~/.cache/opencode/models.json` contains `limit.context` per model. Lookup by `providerID/modelID`.
- **Git** info: local `git` commands (ported from ccstatusline's `git.ts`).
- **cwd:** `message.path.cwd` (or the server's project directory).

## Scope

**Phase 1 (this spec):** functional core — widget engine, live ANSI renderer, Powerline + colors + flex-width, multi-line support, Ink config TUI (items/colors/powerline/preview), the OpenCode-relevant widget set, server connection + event reducer, config persistence, tests.

**Out of scope (later phases, still targeting parity):** Thinking-effort widget (`--variant`), Compaction counter (`session.compacted`), Custom Command widget, advanced Powerline theme library, update-checker, the long tail of niche Git widgets, localizations.

**Permanently dropped (Anthropic-only, no OpenCode equivalent):** Claude Account Email, weekly Opus/Sonnet usage, Extra usage overage, 5h Block timer, Voice/Vim mode.

## Architecture

```
src/
  index.ts            # arg parse → mode "render" (daemon) | "config" (TUI) | "start"
  data/
    server.ts         # OpenCode server discovery/connection (SDK client); manage own `opencode serve` or attach via --server
    event-reducer.ts  # event stream → OpencodeState (pure reducer + subscription glue)
    models.ts         # load ~/.cache/opencode/models.json → context limit by provider/model
    git.ts            # local git info (branch, dirty, ahead/behind, changes, sha)
  render/
    renderer.ts       # RenderContext → ANSI line(s)
    powerline.ts      # powerline separators/caps
    colors.ts         # color resolution (16/256/truecolor)
    ansi.ts           # ANSI escape helpers
    flex.ts           # flex separators / terminal-width fitting
  widgets/            # one module per widget, common Widget interface
  tui/                # Ink config UI: App, ItemsEditor, ColorMenu, PowerlineSetup, StatusLinePreview, StartMenu, LineSelector
  types/              # Settings, Widget, RenderContext, OpencodeState
  utils/              # config (load/save ~/.config/ocstatusline/settings.json), terminal, guid
```

### Component contracts

| Unit | Responsibility | Input → Output | Depends on |
|------|----------------|----------------|------------|
| `data/server.ts` | Get a connected SDK client | config/args → `{ client, serverUrl }` | `@opencode-ai/sdk`, child_process |
| `data/event-reducer.ts` | Fold events into state | `Event` + prev `OpencodeState` → next `OpencodeState` (pure) | types only |
| `data/models.ts` | Context-window lookup | `providerID/modelID` → `contextLimit:number` | models.json |
| `data/git.ts` | Repo status | cwd → `GitInfo` | git CLI |
| `render/renderer.ts` | Compose the line | `RenderContext` (state+settings+widgets+termWidth) → `string` | render/* , widgets/* |
| `widgets/*` | One metric each | `(ctx, widgetConfig) → string` | types only |
| `tui/*` | Edit settings visually | user input → mutated `Settings` (persisted) | render/* (preview), utils/config |

### Widget interface (mirrors ccstatusline)

```ts
interface Widget {
  id: string;                 // stable id, e.g. "model", "cost", "git-branch"
  label: string;              // display name in the editor
  render(ctx: RenderContext, cfg: WidgetConfig): string | null; // null/"" = hide
  defaultConfig?: Partial<WidgetConfig>;
  supportsColors?: boolean;
}
```

### Phase 1 widget set

- **Ported from ccstatusline:** Model, Tokens (Input/Output/Total/Cache), Cost ($), Context Length, Context %, Context Bar, Context Window, Session Timer (duration), Git Branch, Git Clean/Dirty Status, Git Ahead/Behind, Git Changes, Git SHA, Current Working Dir, Custom Text, Custom Symbol, plus separators, Powerline (separators + caps + colors), flex-width / auto width.
- **New (OpenCode-specific):** Provider (`providerID`), Agent/Mode (`mode`).

### Server discovery (Phase 1)

Default: ocstatusline **spawns and manages its own `opencode serve`** on a chosen port and prints `opencode attach http://127.0.0.1:<port>` so the user runs their session against the same server (status + session share one server, daemon subscribes to its events). Override: `--server <url>` to attach to an already-running server. If the managed server exits, the daemon reports and retries/exits cleanly.

### Render loop

Subscribe to `event.subscribe()`. On each relevant event, update `OpencodeState` via the pure reducer and request a repaint (coalesced); also a periodic tick (configurable `refreshInterval`, default 1s) drives time-based widgets (Session Timer). Repaint clears and redraws the configured line(s) within current terminal width.

## Data flow

```
opencode session  ──┐
                    ▼
        OpenCode server (managed or --server)
                    │  client.event.subscribe()
                    ▼
     event-reducer  →  OpencodeState  ──┐
 models.json (ctx limit) ───────────────┤→ RenderContext → renderer → ANSI line(s) → stdout (repaint)
 git.ts (repo status) ──────────────────┘
                    ▲
   settings.json (widgets, colors, powerline, lines)
```

## Error handling

- No server reachable / connection lost: show a clear placeholder line (e.g. `ocstatusline: waiting for opencode server…`) and retry with backoff; never crash-loop.
- Missing models.json or unknown model: context-% widgets degrade gracefully (hide or show raw token count) rather than error.
- Not in a git repo: git widgets render empty (hidden), like ccstatusline.
- Malformed/partial events: reducer ignores unknown event types; defensive optional access.
- Terminal too narrow: flex/truncation per ccstatusline rules.

## Testing

- **Unit (Vitest):** `event-reducer` (sequences of events → expected state, including cost/token accumulation and model switches); each widget (`state → text`, including hide-when-empty); `render`/powerline/flex (composition, separator collapsing, width fitting); `models` (context lookup incl. missing); `git` (mocked CLI output).
- **Manual acceptance:** run a real `opencode` session against the managed server; confirm the live status line updates (model, tokens, cost, context%, session timer, git) and reflows on resize.

## Stack & distribution

- TypeScript; runs on **Bun & Node** (match ccstatusline). **Ink/React** for the config TUI. `@opencode-ai/sdk` for data. Vitest for tests.
- Installable via `npx -y ocstatusline` / `bunx -y ocstatusline` (config TUI by default; `ocstatusline start` / `--render` for the daemon).
- Config at `~/.config/ocstatusline/settings.json`.
- MIT license, standalone repo.

## Open questions (resolved)

1. Name → `ocstatusline`. ✓
2. Render mechanism → standalone live daemon. ✓
3. Server discovery → managed `opencode serve` by default, `--server` override. ✓
4. Scope → phased toward parity; Phase 1 = functional core as above. ✓
