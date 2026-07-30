# Distributing `ocstatusline` via a Homebrew tap

The project ships a [Homebrew Formula](../Formula/ocstatusline.rb) in-repo,
following the same pattern as `uni-chat`'s `Formula/uni-chat.rb`. Because
Homebrew refuses to install a Formula that is not part of a tap, the Formula
is copied into a dedicated **tap repository** on every release.

This document explains how that tap repository is shaped and how a release
gets a new Formula version out to users.

---

## Tap repository

A separate Git repo named `homebrew-<formula>` hosts a copy of the Formula
under `Formula/`. The repo is named with the standard `homebrew-` prefix so
Homebrew recognises it as a tap from the implicit path.

| | |
|---|---|
| Repo URL  | `https://github.com/MikcleGrok/homebrew-ocstatusline` |
| Path      | `Formula/ocstatusline.rb` (verbatim copy of this repo's Formula) |
| Visibility| Public (so `brew install` from anonymous clients works) |
| Branching | Single `main` branch; every release is a commit on `main` |

> The tap repo is **not** a submodule of this repo and it is **not** required
> for the build. It exists purely so Homebrew can fetch the Formula.

---

## End-user install

Once the tap repo exists and contains a release-tagged Formula, an end user
installs the binary in one of two equivalent ways.

### Implicit tap (recommended for documentation)

`brew install <owner>/<tap-name>/<formula>` auto-creates the tap from a repo
named `homebrew-<tap-name>` under `<owner>`. With the names above:

```bash
brew install MikcleGrok/ocstatusline/ocstatusline
```

### Explicit tap (recommended for CI / scripts)

```bash
brew tap MikcleGrok/ocstatusline https://github.com/MikcleGrok/homebrew-ocstatusline
brew install ocstatusline
```

`brew update && brew upgrade` then picks up subsequent releases.

---

## Cutting a release (what to change in the Formula)

After `make release` produces the four binaries and a `build/SHA256SUMS` and
a GitHub Release is published at tag `v<version>` (the workflow in
`.github/workflows/release.yml` does this automatically), update the tap
repo's `Formula/ocstatusline.rb`:

1. Bump `version "<old>"` to `version "<new>"`.
2. Replace each of the four `"0" * 64` placeholder lines under
   `on_macos` / `on_linux` with the matching entry from
   `build/SHA256SUMS`. Use the line whose filename is
   `ocstatusline-<kernel>-<arch>`.
3. Commit on `main` with a message like `ocstatusline <version>`.

That single commit makes the new version installable everywhere within ~1
minute of `brew update` on the user's machine.

There is no automation script yet for this step — the Formula is small, the
SHA256SUMS file lives next to the binaries, and the change is a 5-line diff
that is easy to review in a PR. Add an `update-formula.sh` helper if the
manual flow ever gets in the way.

> While the four `sha256 "0" * 64` placeholders are still identical,
> `brew style` will report four `Style/IdenticalConditionalBranches`
> findings — they vanish the moment real per-platform hashes are pasted
> in, so the manual release flow is the fix rather than rubocop disables
> (which Homebrew's Formula style prohibits).

---

## Local development loop

To exercise the Formula against an in-tree build without publishing a
release, mirror the `uni-chat` `make reinstall` trick: point a local tap at
this checkout, install `--HEAD`, and watch brew's build log.

```bash
brew uninstall --force ocstatusline 2>/dev/null || true
brew tap MikcleGrok/ocstatusline "$(pwd)" 2>/dev/null || true
brew install --HEAD --fetch-HEAD MikcleGrok/ocstatusline/ocstatusline
ocstatusline --version
```

The `--HEAD` build will fail until a release workflow actually produces a
binary; this loop is mainly useful for `brew audit --strict --new
Formula/ocstatusline.rb` (lints the Formula without fetching anything) and
for `brew info` (renders the Formula's metadata).