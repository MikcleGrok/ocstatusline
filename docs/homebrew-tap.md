# Distributing `ocstatusline` via a Homebrew tap

The project ships a [Homebrew Formula](../Formula/ocstatusline.rb) in-repo,
following the same pattern as `uni-chat`'s `Formula/uni-chat.rb`. Because
Homebrew refuses to install a Formula that is not part of a tap, the Formula
is reached through a tap.

> The canonical tap is `MikcleGrok/tools`, shared by all product formulae.

---

## End-user install

```bash
brew tap MikcleGrok/tools https://github.com/MikcleGrok/tools.git
brew install MikcleGrok/tools/ocstatusline
ocstatusline --version   # → v0.1.1 (or whatever just shipped)
```

`brew update && brew upgrade` then picks up subsequent releases — Homebrew
sees the Formula live in the same GitHub repo the release comes from, so
the canonical tap tracks the published formula and release assets.

---

## Local development loop

While the maintainer is iterating on the Formula itself (placeholder
sha256s, new version, etc.), brew should be pointed at a local checkout so
each edit shows up instantly without a `git push`:

```bash
brew uninstall --force ocstatusline 2>/dev/null || true
brew tap MikcleGrok/tools "$(pwd)" 2>/dev/null || true
brew install MikcleGrok/tools/ocstatusline
ocstatusline --version
```

When the next release ships, retap `MikcleGrok/tools` from its canonical remote
before installing the published formula.

---

## Cutting a release (what to change in the Formula)

After `make release` produces the four binaries and a `build/SHA256SUMS` and
a GitHub Release is published at tag `v<version>` (the workflow in
`.github/workflows/release.yml` does this automatically), update the
Formula:

1. Bump `version "<old>"` to `version "<new>"`.
2. Replace each of the four `"0" * 64` placeholder lines under
   `on_macos` / `on_linux` with the matching entry from
   `build/SHA256SUMS`. Use the line whose filename is
   `ocstatusline-<kernel>-<arch>`.
3. Commit on the default branch (`bun-single-binary` here, `main` for the
   upstream pattern) with a message like `chore(formula): pin <version> sha256s`.

That single commit makes the new version installable everywhere within ~1
minute of `brew update` on the user's machine.

While the four `sha256 "0" * 64` placeholders are still identical,
`brew style` reports four `Style/IdenticalConditionalBranches` findings.
They vanish the moment real per-platform hashes are pasted in, so the
manual release flow is the fix rather than rubocop disables (which
Homebrew's Formula style prohibits).

Run `make check-homebrew-formula TAG=v<version>` after `make build-all` and
before publishing or reinstalling. It fails closed when the formula version is
stale, `build/SHA256SUMS` is absent, an asset is missing, or any formula checksum
differs from the local release manifest. Tap publication is external and remains
a required manual action; local verification does not prove that the public tap
has been updated.

---

## Why no separate tap repo

The Homebrew convention `homebrew-<formula>` repo exists so projects where
the upstream is read-only (think `homebrew/core` contributions, or mirrors
of someone else's binary) have a place to host a Formula without touching
the project repo. `ocstatusline` here is a fork the user controls top-to-
bottom, so it owns its own Formula and can rely on the implicit-tap URL
above.

If at some point the repo flips back to private, this pattern needs
amendment: brew cannot read assets behind a private GitHub repo without
inline credentials, and the only workarounds are either another
public host for the binaries (`release.ecomz.net`, an S3 bucket, a public
CDN) or a dedicated public `homebrew-ocstatusline` repo.
