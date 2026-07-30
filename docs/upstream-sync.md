# Keeping this fork in sync with upstream

This fork tracks [amirlehmam/ocstatusline](https://github.com/amirlehmam/ocstatusline).
Two branches, two jobs:

| Branch | Job |
|---|---|
| `main` | A pure mirror of `upstream/main`. It only ever fast-forwards; nothing is committed here. |
| `bun-single-binary` | Everything this fork adds: the Bun single-binary build, the Docker/Makefile toolchain, the mock server, CI and the release workflow. |

Remotes: `origin` is this fork, `upstream` is the original repository.

## The routine

```bash
make sync-upstream          # fetch, fast-forward main, report what is missing
git rebase main             # your call — this rewrites the work branch's history
make sync-verify            # lock + check-yoga + test + smoke, all in Docker
```

`make sync-upstream` deliberately stops before the rebase: rewriting history is a
decision, not a build step.

If `git rebase` reports conflicts, resolve them in favour of *both* intents — the
upstream change and the fork's change — and re-run `make sync-verify` before
committing anything else.

## After an `ink` or `yoga-layout` bump — check the WASM loader first

`bun build --compile` is a static bundler and cannot follow
`createRequire(import.meta.url).resolve('yoga.wasm')`. Some `yoga-layout` releases
resolve their WASM exactly that way, which breaks the compiled binary at runtime
(oven-sh/bun#6567, #13552, #15639); releases from 3.2.1 on inline the WASM as
base64 and import it statically.

So whenever the dependency tree moves:

```bash
make lock
make check-yoga
```

- `OK: yoga-layout loads its WASM statically` → nothing to do.
- `FAIL: yoga-layout resolves its WASM dynamically` → pin the dependency again in a
  single commit on a branch cut from a fresh `upstream/main`, so the same commit can
  be offered upstream as its own pull request:

  ```bash
  git fetch upstream
  git switch -c yoga-wasm-static-loader upstream/main
  # add "overrides": { "yoga-layout": "3.2.1" } to package.json
  make lock && make check-yoga
  git commit -am "fix(deps): pin yoga-layout 3.2.1 so its WASM loader stays statically analyzable"
  ```

The opposite outcome matters too: if a future `ink` ships a `yoga-layout` that no
longer needs the pin, drop the `overrides` block and let `make check-yoga` prove it.

## Re-recording the event fixtures

OpenCode's SSE event protocol is not versioned. `@opencode-ai/sdk` shields the code
from most of it, but the recorded fixtures under `tests/fixtures/events/` can drift
out of shape after an SDK bump — so re-record them as part of a sync, not as a
one-off:

```bash
opencode serve                       # in another terminal, on the host
make record-fixture OUT=tests/fixtures/events/normal-session.jsonl SERVER=http://host.docker.internal:4096
make test && make smoke
```

Drive a real session while recording, and cover the same five situations the corpus
is built around: a normal session, a failing tool call, a dropped connection, an
idle session, and malformed/unexpected events. `tests/fixtures/events/garbage.jsonl`
is hand-written on purpose — a real server will not emit malformed events on demand.

## Release after a sync

```bash
make release                         # gates + every target + SHA256SUMS
git tag -a vX.Y.Z -m "…" && git push origin vX.Y.Z
```

The tag triggers `.github/workflows/release.yml`, which runs the same `make release`
and publishes the binaries plus `SHA256SUMS`.