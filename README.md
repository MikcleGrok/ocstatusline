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
- **Rich widget set** — model, provider, agent/mode, token totals, cost, context length / %, context bar, context window, session timer, OpenRouter weekly balance, git branch / dirty / ahead-behind / changes / SHA, working dir, custom text & symbols.
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

## Applicability and onboarding record

| Field | Value |
| --- | --- |
| `project type` | Bun/TypeScript CLI, live daemon, config TUI and four-platform standalone binary |
| `active profiles` | CLI, TUI, daemon/service, publishable binary and Homebrew distribution |
| `not applicable` | npm package runtime, container runtime image and server-side deployment |
| `supported targets` | `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`; smoke uses the local Docker engine platform |
| `build/test entrypoint` | GNU make targets backed by Docker Compose; start with `make help` and `make ci-test` |
| `toolchain reference` | `BUN_BASE_IMAGE_REF` in `.env.dist`, pinned to an immutable Docker manifest digest; `BUN_VERSION` is updated with it |
| `release channels` | GitHub Release assets, Homebrew formula and offline `dist/local-release/` bundle |
| `release checks` | `make release` builds all targets, runs typecheck/tests/TUI and binary smoke, and writes `SHA256SUMS`; no provenance signer is configured |
| `owners` | repository maintainer owns build, release and security decisions |
| `review trigger` | review this record when targets, distribution channel, toolchain reference or release checks change |

The Docker base digest is a controlled pin, not a claim that the image is
reproducible without verification. When upgrading Bun, resolve the new
multi-platform manifest digest, update `BUN_VERSION` and `BUN_BASE_IMAGE_REF`
together, then run `make image` and the fast checks before committing.

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

Weekly OpenRouter severity colors are optional ANSI-256 integer values. Missing
or invalid values use the defaults, and partial objects are merged:

```json
{
  "severityColors": {
    "skyBlue": 75,
    "teal": 37,
    "mutedGreen": 71,
    "orange": 208,
    "darkRed": 124,
    "overBudget": 90
  }
}
```

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

### Экспериментальный TUI adapter для OpenCode 1.18.x

В checkout есть TUI plugin `.opencode/tui-plugins/ocstatusline.ts`. Каталог
`.opencode/plugins/` предназначен для server hooks и обслуживается отдельным
server plugin loader; TUI-only module там размещать нельзя. Регистрация TUI
plugin выполняется через `.opencode/tui.json` с ключом `plugin`. Plugin
регистрирует footer `app_bottom` и берет данные из текущей TUI session через
локальный `@opencode-ai/plugin` API, без второго SDK-клиента или SSE-подключения.
Этот API не является стабильным или официальным status-line API OpenCode. Custom
footer имеет формат `$47.78 · sender · DEV-15309`: `sender` — basename корня
Git-репозитория, branch выводится целиком. Баланс `ocstatusline` больше не
запрашивает у OpenRouter напрямую и не читает никакие ключи сам: он подключается
к локальному демону [`secretd`](https://github.com/MikcleGrok/secretd) по Unix
socket `~/.secretd/sock` и вызывает его модуль `openrouter/credits` (общий
account balance по management-ключу, `total_credits - total_usage`). Если
`secretd` отвечает `ok: true` без данных (секрет ещё не зарегистрирован),
`ocstatusline` вызывает модуль `openrouter/key-limit` (per-key remaining limit
ключа, выданного OpenCode) как второй источник. Оба модуля и приоритет между
ними задаёт сам `secretd`; `ocstatusline` только читает результат.
Строка серого цвета получает один левый отступ через OpenTUI `paddingLeft: 1`.
Штатный footer OpenCode сохраняется и продолжает показывать model, context,
session cost, timer и прочие widgets; custom footer их не дублирует.
Для запуска plugin из checkout:

```bash
cd /path/to/ocstatusline
npm install --prefix .opencode --no-audit --no-fund
opencode
```

Если `secretd` не установлен или не запущен, подключение к сокету не
удаётся, и это ожидаемое, не ошибочное состояние: баланс просто не
отображается (footer выводится без суммы), пока демон не поднят. Установка и
настройка `secretd` — вне области этого README, см.
[репозиторий `secretd`](https://github.com/MikcleGrok/secretd).
последнее успешно полученное значение сохраняется до следующего успешного
обновления. На home route custom строка может быть нейтральной до завершения
асинхронного git refresh; вне Git-репозитория она остается пустой. Баланс
обновляется асинхронно при запуске и не чаще одного раза в 60 секунд, поэтому
network request не выполняется из render callback. Git-информация также
загружается асинхронно при запуске: обычный refresh выполняется не чаще одного
раза в 10 секунд, но при смене route, session или cwd новый git state загружается
немедленно; render callback только читает уже загруженное состояние.

Запускайте OpenCode из корня проекта: внешний TUI loader читает
`.opencode/tui.json`, а относительный entry `./tui-plugins/ocstatusline.ts`
разрешается относительно каталога `.opencode/`. Откройте или создайте session,
дождитесь assistant message и проверьте нижнюю строку TUI. На home route после
завершения асинхронного git refresh там отображаются project root и branch.
Откройте или создайте session и проверьте, что строка обновляется для session
cwd отдельно. После изменения `tui.json`, plugin или его зависимостей
полностью выйдите из OpenCode, убедитесь, что старых процессов не осталось, и
запустите его снова: loader не перезагружает
уже запущенный TUI.

`.opencode/package.json` закрепляет публичные зависимости `@opentui/solid`,
`@opentui/core`, `@opentui/keymap` и `@opencode-ai/plugin` на совместимых версиях;
они нужны runtime loader, а не standalone binary. Версия OpenCode и версия
`@opencode-ai/plugin` связаны: проверенная комбинация сейчас `1.18.10` и
`1.18.5`; обновление любой из них может потребовать изменений adapter.
Standalone binary, установленный из релиза, не содержит project plugin и не
обнаруживает его автоматически. Для такого окружения используйте fallback:

```bash
ocstatusline start --server http://127.0.0.1:4096
```

Custom footer передает OpenTUI только plain text без ANSI/control sequences;
штатный OpenCode footer остается отдельным slot и продолжает работать.

#### Глобальная установка: `ocstatusline install`

По умолчанию plugin грузится только когда OpenCode запущен из корня этого
checkout, потому что TUI plugin loader читает исключительно project-local
`.opencode/tui.json`, глобального механизма подключения нет. Команда
`ocstatusline install` регистрирует plugin в глобальном OpenCode config
(`~/.config/opencode/`, либо `$XDG_CONFIG_HOME/opencode`, если переменная
задана), так что он грузится в любом проекте на этой машине. Команда:

- копирует `.opencode/tui-plugins/ocstatusline.ts` и весь его dependency
  closure (`src/tui/footer.ts`, `src/tui/openrouter.ts`, `src/data/git.ts`,
  `src/data/openrouter-weekly.ts`, `src/types/index.ts`,
  `src/utils/config.ts`) в глобальный config dir, переписывая
  `../../src/...` imports plugin entry на `../src/...` — глубина вложенности
  меняется, потому что глобальный config dir играет роль `.opencode/`, а не
  корня репозитория;
- мёржит закреплённые версии зависимостей из `.opencode/package.json` в
  `<configDir>/package.json`, не трогая посторонние поля и уже
  присутствующие там другие зависимости;
- выполняет `npm install --prefix <configDir> --no-audit --no-fund`;
- идемпотентно добавляет `./tui-plugins/ocstatusline.ts` в массив `plugin`
  внутри `<configDir>/tui.json`, создавая файл при необходимости и сохраняя
  все прочие ключи (например, `keybinds`) и уже существующие `plugin`
  entries как есть; повторный запуск не создаёт дубликат.

Запуск — из checkout или из установленного бинарника, команда одна и та же:

```bash
# из checkout — dev/source режим, файлы читаются с диска
cd /path/to/ocstatusline && bun run src/index.ts install

# из установленного бинарника — из любого каталога, файлы берутся изнутри него
ocstatusline install
```

Два источника plugin-файлов, один и тот же результат:

- **disk (по умолчанию).** Если `src/` и `.opencode/` этого репозитория
  физически лежат на диске рядом с запускаемым модулем (обычный checkout или
  toolchain-контейнер), берутся именно они — разработчик получает то, что
  только что отредактировал, а не то, что было вкомпилировано при сборке.
- **embedded (fallback).** У скомпилированного standalone binary никакого
  checkout нет: `bun build --compile` кладёт исходники в собственную
  виртуальную файловую систему (`/$bunfs/root`), недоступную по обычным
  путям. Поэтому весь closure plugin'а вместе с pin'ами зависимостей
  запекается в бинарник на этапе сборки — генератором
  `scripts/generate-tui-plugin-assets.ts` в обычный TypeScript-модуль строковых
  констант `src/tui/embedded-plugin-assets.generated.ts` (он коммитится, и
  `tsc`/`vitest` работают без Bun и без предварительной генерации). Попытка
  прочитать с диска падает с единственной распознаваемой ошибкой
  `RepoCheckoutNotFoundError`, и только на неё `install` повторяется уже с
  embedded-копией; любая другая ошибка (упавший `npm install`, битый
  `tui.json`) пробрасывается как есть.

После правки plugin'а, его closure или `.opencode/package.json` — перегенерируй
embedded-копию, иначе бинарник поставит устаревший plugin:

```bash
make generate-tui-plugin-assets
```

Расхождение между сгенерированным файлом и репозиторием ловит
`tests/tui/install.test.ts` (обычным `make test`), так что забыть про
регенерацию молча не получится.

---

## Configuration

Config lives at `~/.config/ocstatusline/settings.json`. It is created on first save and merged with defaults on load (a partial file still works). Shape:

```jsonc
{
  "refreshInterval": 1000,          // ms between time-based repaints
  "colorLevel": "truecolor",        // "ansi16" | "ansi256" | "truecolor"
  "openrouter": { "weeklyBudgetUsd": 25 },
  "powerline": {
    "enabled": false,
    "separator": "",               // glyph between segments when enabled
    "separatorReverse": ""
  },
  "lines": [                        // one array of widgets per status line
    [
      { "type": "model", "color": "cyan", "bold": true },
      { "type": "mode", "color": "cyan" },
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
| `openrouter-weekly` | Account balance remaining from the Monday-local weekly budget, plus time until the next window |
| `tokens` | Total tokens used |
| `context-length` / `context-percentage` / `context-bar` / `context-window` | Live context occupancy (needs `~/.cache/opencode/models.json`) |
| `session-timer` | Elapsed session time |
| `git-branch` / `git-clean-status` / `git-ahead-behind` / `git-changes` / `git-sha` | Git repo state for the session's cwd |
| `cwd` | Working directory basename |
| `custom-text` / `custom-symbol` | Your own literal text / symbol |

Each widget accepts `color` (a name like `cyan` or a hex like `#88c0d0`) and `bold`. `openrouter-weekly` uses fallback thresholds when account data is available: below 10% is dark red, below 25% is yellow, and otherwise its configured color. The OpenCode TUI footer balance uses the same thresholds (red/yellow/gray) and keeps the existing balance, repository, and branch format. Key-limit data is never treated as weekly spend. Widgets that have nothing to show (e.g. git outside a repo, context % with no known model) hide themselves automatically. Its runtime anchor is stored separately at `~/.config/ocstatusline/openrouter-weekly-window.json`.

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
make smoke           # run the compiled binary: --version, live render, pty TUI, plugin install
make mock-up         # start the fixture-playback OpenCode mock
make ci-test         # exactly what CI runs
make release         # gates + all targets + SHA256SUMS
make release-check TAG=v0.2.6 # pre-tag candidate gate; does not publish
make release-local TAG=v0.2.6   # exact clean tag: local binaries/source/manifest/notes
make clean           # drop the cache volumes and ./build
```

`make release-local` is the offline release path. It requires `TAG` to point
exactly at `HEAD` and a clean worktree, runs the same local gates as `make
release`, then stores the binaries, a deterministic source archive,
`SHA256SUMS`, `manifest.json`, and `release-notes.md` in
`dist/local-release/<version>/`. It does not require GitHub, GitLab, `gh`, an
API token, Docker publication, a registry, or any other external service.
The manifest's `artifacts` list contains exactly the four binaries; `source` is
the separate deterministic source archive. `SHA256SUMS` contains exactly those
four binaries and that source archive, so every distributable file is covered.
The output directory is intentionally never removed or merged: if
`dist/local-release/<version>/` already exists, the command fails before
writing it. Remove that directory explicitly when a replacement is intended;
unrelated files in an existing output directory are therefore never deleted.
`make local-release TAG=...` is an alias. Publication targets, if added later,
must remain separate from this local target.

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
Prebuilt Homebrew assets и `SHA256SUMS` проверяются через
`scripts/check-homebrew-formula.sh` и общий verifier из `guide-tools`; внешний tap не
изменяется автоматически.
