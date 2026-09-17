# Distributing `ocstatusline` via a Homebrew tap

The production Formula lives in the canonical tap repository
`homebrew-mikclegrok-tools/Formula/ocstatusline.rb`. The source repository
owns the version tag and GitHub Release assets; it does not expose a second
installable Formula.

> The canonical tap is `mikclegrok/tools`, shared by all product formulae.

---

## End-user install

```bash
brew tap mikclegrok/tools https://github.com/MikcleGrok/tools.git
brew install mikclegrok/tools/ocstatusline
ocstatusline --version   # → v0.2.10 (published release)
```

`brew update && brew upgrade` then picks up subsequent releases. The Formula
is updated separately in the tap after the source repository GitHub Release is
published.

---

## Local development loop

While iterating on the Formula, validate the canonical tap checkout directly;
do not add a second stable tap or rely on a short formula name:

```bash
HOMEBREW_TAP_DIR=/path/to/homebrew-mikclegrok-tools make check-homebrew-formula TAG=v<version>
```

`make release` не требует tap checkout и не проверяет Formula: source Release
публикуется первым. `make check-homebrew-formula` является отдельным tap gate и
отказывается работать без явно заданного `HOMEBREW_TAP_DIR`.

When the next release ships, update the Formula in `MikcleGrok/tools` from the
source repository release, then retap from its canonical remote before
installing the published formula.

---

## Cutting a release (what to change in the Formula)

After `make release` produces the four binaries and a `build/SHA256SUMS`, and
the GitHub Release is published at tag `v<version>`, update the Formula:

1. Update `homebrew-mikclegrok-tools/Formula/ocstatusline.rb`, bumping
   `version "<old>"` to `version "<new>"`.
2. Replace each of the four `"0" * 64` placeholder lines under
   `on_macos` / `on_linux` with the matching entry from
   `build/SHA256SUMS`. Use the line whose filename is
   `ocstatusline-<kernel>-<arch>`.
3. Commit only the Formula change in the canonical tap repository.

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

Текущий production release: `v0.2.10`. Его macOS arm64 asset должен сохранять
published SHA-256 `12ee9c604efee491e39aa98745eb0b1ca187b0443f85c6c853b8244b711b8e6c`.
Локально собранный asset с другим digest не является release asset и должен
отклоняться checker. Untracked Formula в локальном tap checkout -- только
подготовленные metadata; это не доказывает публикацию canonical tap.

## Canonical ownership

`mikclegrok/tools` is the only production tap. `mikclegrok/ocstatusline-audit`
is not referenced or modified by this flow; no tap cleanup or installed
Homebrew state mutation is performed here.
