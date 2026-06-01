# ocstatusline

> A highly customizable, **live** status line for [OpenCode](https://github.com/sst/opencode) — the OpenCode counterpart of [ccstatusline](https://github.com/sirmalloc/ccstatusline).

`ocstatusline` runs as a small standalone process that subscribes to an OpenCode server's event stream and continuously repaints a configurable status line — your model, provider, mode, token usage, cost, context window %, session timer, and git state — right in your terminal.

```
qwen3-coder · main* · ctx 42% · $0.12 · 3m12s
```

It ships with an interactive **config TUI** (built with [Ink](https://github.com/vadimdemedes/ink)) so you can compose your status line visually, with a live preview, and save it — no hand-editing JSON required.

---

## Why this exists

[ccstatusline](https://github.com/sirmalloc/ccstatusline) works because **Claude Code reserves a status-line slot and invokes an external command**, handing it a JSON snapshot on each refresh. It installs itself into Claude's `settings.json` and is *pulled* once per refresh.

**OpenCode has no equivalent.** There is no status-line hook, no external-command slot for a persistent footer, and the built-in TUI status bar is not pluggable. So `ocstatusline` inverts the model:

| | ccstatusline (Claude Code) | ocstatusline (OpenCode) |
|---|---|---|
| Trigger | **Pull** — invoked per refresh | **Push** — subscribes to the live event stream |
| Output | Writes to Claude's status-line slot | Autonomous ANSI daemon in its own pane |
| Data source | Claude JSONL transcripts + usage API | `@opencode-ai/sdk` events + `models.json` + git |
| Lifecycle | One-shot process | Long-lived daemon |

It reuses ~70% of ccstatusline's concepts (widget engine, Powerline, colors, flex-width, an Ink config TUI); only the **data source** and the **output mechanism** differ.

---

## Features

- **Live, event-driven** — repaints instantly as your session produces tokens, switches model, or changes cost; a periodic tick keeps time-based widgets (session timer) fresh.
- **Rich widget set** — model, provider, agent/mode, token totals, cost, context length / %, context bar, context window, session timer, git branch / dirty / ahead-behind / changes / SHA, working dir, custom text & symbols.
- **Powerline, colors, flex-width** — named or `#rrggbb` colors (16/256/truecolor), optional Powerline separators, automatic truncation to the terminal width, multi-line layouts.
- **Interactive config TUI** — compose lines, reorder/recolor widgets, toggle Powerline, manage multiple lines, all with a live preview. Run `ocstatusline` with no arguments.
- **Two connection modes** — spawn and manage its own `opencode serve` (default), or attach to an already-running server with `--server`.
- **Graceful degradation** — no server, missing `models.json`, no git repo, or a narrow terminal never crash it; affected widgets simply hide.

---

## Requirements

- **Node.js ≥ 22** (the project is developed and tested on Node 24).
- **[OpenCode](https://github.com/sst/opencode) ≥ 1.2.6** available on your `PATH` (`opencode`), if you want `ocstatusline` to manage its own server.

---

## Install

Run it directly with no install:

```bash
npx ocstatusline          # open the config TUI
npx ocstatusline start    # run the live daemon
```

Or install globally:

```bash
npm install -g ocstatusline
ocstatusline               # config TUI
ocstatusline start         # live daemon
```

### From source

```bash
git clone https://github.com/amirlehmam/ocstatusline.git
cd ocstatusline
npm install
npm run build
npm link                   # optional: expose the `ocstatusline` command
```

If you skip `npm link`, run it with `node dist/index.js …` instead of `ocstatusline …`.

---

## Usage

### Configure (interactive TUI)

```bash
ocstatusline
```

Opens the config editor. Navigate with the arrow keys, `Enter` to select, `Esc` to go back:

```
ocstatusline config
> Edit line items
  Powerline setup
  Lines (add/remove)
  Settings
  Preview
  Save & exit
```

- **Edit line items** — `a` add a widget, `d` remove, `</>` reorder, `e` set color / edit text. For a widget, the color menu offers the named palette, a custom `#rrggbb` entry, and a bold toggle (`b`).
- **Lines** — add / remove / select status lines (multi-line layouts are supported).
- **Powerline setup** — toggle Powerline and set the separator glyphs.
- **Settings** — refresh interval (ms) and color level (`ansi16` / `ansi256` / `truecolor`).
- **Preview** — see your line rendered with representative sample data.
- **Save & exit** — writes `~/.config/ocstatusline/settings.json`.

### Run the live daemon

Managed server (default) — `ocstatusline` spawns its own `opencode serve` and prints an attach URL:

```bash
ocstatusline start
# ocstatusline: managed server at http://127.0.0.1:4096
#   attach your session with: opencode attach http://127.0.0.1:4096
```

Then point your session at the same server (`opencode attach http://127.0.0.1:4096`) and watch the status line update live.

Attach mode — track an already-running OpenCode server:

```bash
ocstatusline start --server http://127.0.0.1:4096
```

A typical setup is to run `ocstatusline start` in one pane (or a split) and your `opencode` session in another, so the status line sits alongside your work.

---

## Configuration

Config lives at `~/.config/ocstatusline/settings.json`. It is created on first save and merged with defaults on load (a partial file still works). Shape:

```jsonc
{
  "refreshInterval": 1000,          // ms between time-based repaints
  "colorLevel": "truecolor",        // "ansi16" | "ansi256" | "truecolor"
  "powerline": {
    "enabled": false,
    "separator": "",               // glyph between segments when enabled
    "separatorReverse": ""
  },
  "lines": [                        // one array of widgets per status line
    [
      { "type": "model", "color": "cyan", "bold": true },
      { "type": "git-branch", "color": "magenta" },
      { "type": "context-percentage", "color": "yellow" },
      { "type": "cost", "color": "green" },
      { "type": "session-timer", "color": "blue" }
    ]
  ]
}
```

### Available widgets

| Type | Shows |
|------|-------|
| `model` / `provider` / `mode` | Current model id / provider / agent mode |
| `cost` | Session cost in USD |
| `tokens` | Total tokens used |
| `context-length` / `context-percentage` / `context-bar` / `context-window` | Live context occupancy (needs `~/.cache/opencode/models.json`) |
| `session-timer` | Elapsed session time |
| `git-branch` / `git-clean-status` / `git-ahead-behind` / `git-changes` / `git-sha` | Git repo state for the session's cwd |
| `cwd` | Working directory basename |
| `custom-text` / `custom-symbol` | Your own literal text / symbol |

Each widget accepts `color` (a name like `cyan` or a hex like `#88c0d0`) and `bold`. Widgets that have nothing to show (e.g. git outside a repo, context % with no known model) hide themselves automatically.

---

## How it works

```
opencode session ─┐
                  ▼
      OpenCode server (managed or --server)
                  │  client.event.subscribe()
                  ▼
   event reducer  →  in-memory state  ──┐
 models.json (ctx limit) ───────────────┤→ selectors → render → ANSI line(s) → stdout
 git (repo status) ──────────────────────┘
                  ▲
   settings.json (widgets, colors, powerline, lines)
```

A pure reducer folds OpenCode events into in-memory state (deduping streaming message updates so cost/tokens are never double-counted). Pure selectors derive display values; the renderer composes the configured widgets into colored, width-fitted line(s) and repaints. The config TUI edits the same `Settings` the daemon consumes.

---

## Development

```bash
npm run dev          # run the entry point with tsx
npm run build        # compile TypeScript → dist/
npm test             # run the Vitest suite
npm run typecheck    # tsc --noEmit
```

The codebase keeps a strict **pure-core / IO-at-the-edges** split: the event reducer, selectors, git parser, color/render helpers, widgets, and the TUI edit-state reducer are pure and unit-tested; the SDK connection, git CLI, filesystem, and Ink rendering live at the boundaries. That's why the bulk of behavior is covered by fast, deterministic unit tests.

```
src/
  index.ts            CLI dispatcher (TUI vs daemon)
  daemon.ts           live render loop
  cli.ts              argument parsing
  data/               server connection, event reducer, selectors, models, git
  render/             ansi, colors, powerline, flex, renderer
  widgets/            widget registry
  tui/                Ink config UI (pure edit reducer + thin screens)
  types/              shared domain types
  utils/              settings load/save
```

---

## Status & roadmap

**Shipped:** the live daemon and full render/data core; the OpenCode-relevant widget set; Powerline, colors, flex-width, multi-line; and the interactive config TUI.

**Planned (toward fuller ccstatusline parity):** per-segment Powerline color transitions, thinking-effort and compaction widgets, a Custom Command widget, an advanced Powerline theme library, and an update checker.

---

## Credits

Inspired by and modeled after [ccstatusline](https://github.com/sirmalloc/ccstatusline) by [@sirmalloc](https://github.com/sirmalloc). Built for [OpenCode](https://github.com/sst/opencode).

## License

[MIT](./LICENSE)
