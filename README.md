# ocstatusline

> A highly customizable, **live** status line for [OpenCode](https://github.com/sst/opencode) — the OpenCode counterpart of [ccstatusline](https://github.com/sirmalloc/ccstatusline).
>
> **Fork of [amirlehmam/ocstatusline](https://github.com/amirlehmam/ocstatusline)** (MIT), which this fork keeps in sync via its `upstream` remote.
> What is different here: the artifact is a **single self-contained binary** (`bun build --compile`, four platforms) instead of an npm package, and the entire build/test/release toolchain is pinned in Docker and driven through `make`.
> See [NOTICE](./NOTICE) for the attribution and [docs/upstream-sync.md](./docs/upstream-sync.md) for the sync procedure.

`ocstatusline` runs as a small standalone process that subscribes to an OpenCode server's event stream and continuously repaints a configurable status line — your model, provider, mode, token usage, cost, context window %, session timer, and git state — right in your terminal. It also provides a one-shot stdin renderer for integrations that explicitly invoke it.

```
qwen3-coder · main* · ctx 42% · $0.12 · 3m12s
```

It ships with an interactive **config TUI** (built with [Ink](https://github.com/vadimdemedes/ink)) so you can compose your status line visually, with a live preview, and save it — no hand-editing JSON required.

---

## Why this exists

[ccstatusline](https://github.com/sirmalloc/ccstatusline) works because **Claude Code reserves a status-line slot and invokes an external command**, handing it a JSON snapshot on each refresh. It installs itself into Claude's `settings.json` and is *pulled* once per refresh.

**OpenCode has no equivalent.** There is no direct official status-line hook, no external-command slot for a persistent footer, and the built-in TUI status bar is not pluggable. OpenCode does not invoke `ocstatusline render --stdin` automatically. So `ocstatusline` inverts the model:

| | ccstatusline (Claude Code) | ocstatusline (OpenCode) |
|---|---|---|
| Trigger | **Pull** — invoked per refresh | **Push** — subscribes to the live event stream |
| Output | Writes to Claude's status-line slot | Autonomous ANSI daemon in its own pane |
| Data source | Claude JSONL transcripts + usage API | `@opencode-ai/sdk` events + `models.json` + git |
| Lifecycle | One-shot process | Long-lived daemon, or explicitly invoked one-shot render |

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

- **Nothing at runtime.** The release artifact is a single self-contained binary with the Bun runtime inside it — no Node.js, no npm, no `node_modules`.
- **[OpenCode](https://github.com/sst/opencode) ≥ 1.2.6** available on your `PATH` (`opencode`), if you want `ocstatusline` to manage its own server.
- **To build it yourself:** Docker and GNU make. The Bun version is pinned inside the toolchain image, so nothing has to be installed on the host.
- **On musl distributions (Alpine):** the published Linux builds are glibc binaries — install `gcompat` (`apk add gcompat`) before running one.

---

## Install

### Homebrew (macOS or Linux)

```bash
brew install MikcleGrok/ocstatusline/ocstatusline
```

One command, no tap setup — Homebrew auto-creates the
`MikcleGrok/ocstatusline` tap from `github.com/MikcleGrok/homebrew-ocstatusline`
and installs the matching prebuilt binary. `brew update && brew upgrade`
picks up new releases. See [docs/homebrew-tap.md](./docs/homebrew-tap.md) for
how the tap repo is laid out and how a release updates it.

### Prebuilt binary

Download the binary for your platform from the [latest release](https://github.com/MikcleGrok/ocstatusline/releases/latest), verify it, make it executable:

```bash
curl -fsSLO https://github.com/MikcleGrok/ocstatusline/releases/latest/download/ocstatusline-darwin-arm64
curl -fsSLO https://github.com/MikcleGrok/ocstatusline/releases/latest/download/SHA256SUMS
sha256sum --ignore-missing -c SHA256SUMS
chmod +x ocstatusline-darwin-arm64
./ocstatusline-darwin-arm64 --version
```

Four builds are published per release: `ocstatusline-darwin-arm64`, `ocstatusline-darwin-x64`, `ocstatusline-linux-x64`, `ocstatusline-linux-arm64`. Put the one you downloaded somewhere on your `PATH` as `ocstatusline`.

### From source

Docker and GNU make are the only prerequisites — the Bun version is pinned inside the toolchain image:

```bash
git clone https://github.com/MikcleGrok/ocstatusline.git
cd ocstatusline
make build            # binary for your own platform, into ./build
make test             # the vitest suite, inside the toolchain image
make smoke            # runs the compiled binary and asserts its output
make build-all        # cross-compile every published target
make help             # every available target
```

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

### Render one snapshot from stdin

`render --stdin` reads exactly one JSON object until EOF and writes ordinary
newline-terminated lines. It never performs cursor-control repainting. This is
an `ocstatusline` contract, not a Claude contract, and OpenCode does not call it
automatically because OpenCode currently has no official status-line hook.

```bash
printf '%s\n' '{"version":1,"model":"qwen3-coder","provider":"ollama","mode":"build","cwd":"/work/app","tokens":{"input":6000,"output":300},"context":{"tokens":6553,"limit":65536},"cost":0.04,"sessionDurationMs":192000,"termWidth":120,"git":{"isRepo":true,"branch":"main","dirty":false}}' | ocstatusline render --stdin
```

The versioned input shape is owned by `ocstatusline`: `version` is optional for
backward compatibility; when provided, it must be `1`, and
`model`, `provider`, `mode`, `cwd`, `tokens` (including optional `total`), `context`, `cost`,
`sessionDurationMs`, `termWidth`, and `git` are optional. Missing optional data
is rendered as empty or zero values where appropriate. Invalid JSON or an
unsupported version is reported on stderr and exits with status 1.

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

Everything runs in Docker through `make`; there are no raw `docker compose` commands to type and no host toolchain to install.

```bash
make help            # every target, with a one-line description
make install         # bun install --frozen-lockfile into the cache volumes
make test            # the vitest suite inside the pinned toolchain image
make typecheck       # tsc --noEmit
make check-yoga      # assert yoga-layout still loads its WASM statically
make build           # compile for your own platform into ./build
make build-all       # cross-compile every release target
make smoke           # run the compiled binary: --version, live render, pty TUI
make mock-up         # start the fixture-playback OpenCode mock
make ci-test         # exactly what CI runs
make release         # gates + all targets + SHA256SUMS
make clean           # drop the cache volumes and ./build
```

The version reported by `--version` is stamped at build time from `git describe --tags --always --dirty`; a tree checked out without a build reports `dev`.

Keeping the fork current is documented in [docs/upstream-sync.md](./docs/upstream-sync.md).

---

## Status & roadmap

**Shipped:** the live daemon and full render/data core; the OpenCode-relevant widget set; Powerline, colors, flex-width, multi-line; and the interactive config TUI.

**Planned (toward fuller ccstatusline parity):** per-segment Powerline color transitions, thinking-effort and compaction widgets, a Custom Command widget, an advanced Powerline theme library, and an update checker.

---

## Credits

Inspired by and modeled after [ccstatusline](https://github.com/sirmalloc/ccstatusline) by [@sirmalloc](https://github.com/sirmalloc). Built for [OpenCode](https://github.com/sst/opencode).

## License

[MIT](./LICENSE)
