#!/usr/bin/env bash
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

mkdir -p "$fixture/guide-tools/bin" "$fixture/tap/Formula"
cat > "$fixture/guide-tools/bin/guide-distribution-verify" <<'VERIFIER'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" > "${VERIFY_ARGS_FILE:?VERIFY_ARGS_FILE must be set}"
VERIFIER
chmod +x "$fixture/guide-tools/bin/guide-distribution-verify"
printf '%s\n' 'class Ocstatusline < Formula' > "$fixture/tap/Formula/ocstatusline.rb"

args_file="$fixture/args"
GUIDE_TOOLS_ROOT="$fixture/guide-tools" HOMEBREW_TAP_DIR="$fixture/tap" VERIFY_ARGS_FILE="$args_file" TAG=v1.2.3 bash "$root/scripts/verify-distribution.sh" --check --version 0.2.15

grep -Fx -- '--check' "$args_file" >/dev/null
grep -Fx -- '--tag' "$args_file" >/dev/null
grep -Fx -- 'v1.2.3' "$args_file" >/dev/null
grep -Fx -- '--version' "$args_file" >/dev/null
grep -Fx -- '0.2.15' "$args_file" >/dev/null
if grep -Fx -- 'v0.2.15' "$args_file" >/dev/null; then
  printf '%s\n' 'version must be forwarded without a v prefix' >&2
  exit 1
fi
grep -Fx -- 'https://github.com/MikcleGrok/ocstatusline' "$args_file" >/dev/null
grep -Fx -- '--profile' "$args_file" >/dev/null
grep -Fx -- 'prebuilt' "$args_file" >/dev/null
grep -Fx -- '--formula' "$args_file" >/dev/null
grep -Fx -- "$fixture/tap/Formula/ocstatusline.rb" "$args_file" >/dev/null
grep -Fx -- '--manifest' "$args_file" >/dev/null
grep -Fx -- "$root/build/SHA256SUMS" "$args_file" >/dev/null
grep -Fx -- '--assets' "$args_file" >/dev/null
grep -Fx -- 'ocstatusline-darwin-arm64,ocstatusline-darwin-x64,ocstatusline-linux-arm64,ocstatusline-linux-x64' "$args_file" >/dev/null

: > "$args_file"
if GUIDE_TOOLS_ROOT="$fixture/guide-tools" HOMEBREW_TAP_DIR="$fixture/tap" VERIFY_ARGS_FILE="$args_file" bash "$root/scripts/verify-distribution.sh" --version v0.2.15 2>"$fixture/invalid-version.error"; then
  printf '%s\n' 'expected --version with a v prefix to be rejected' >&2
  exit 1
fi
grep -F 'ERROR: --version must be a safe SemVer MAJOR.MINOR.PATCH without a v prefix' "$fixture/invalid-version.error" >/dev/null
test ! -s "$args_file"

if GUIDE_TOOLS_ROOT="$fixture/missing-guide-tools" HOMEBREW_TAP_DIR="$fixture/tap" bash "$root/scripts/verify-distribution.sh" 2>"$fixture/missing-guide-tools.error"; then
  printf '%s\n' 'expected missing guide-tools to block the distribution gate' >&2
  exit 1
fi
grep -F 'distribution gate blocker: guide-distribution-verify is unavailable' "$fixture/missing-guide-tools.error" >/dev/null

if GUIDE_TOOLS_ROOT="$fixture/guide-tools" HOMEBREW_TAP_DIR="$fixture/missing-tap" bash "$root/scripts/verify-distribution.sh" 2>"$fixture/missing-tap.error"; then
  printf '%s\n' 'expected missing Homebrew tap to block the distribution gate' >&2
  exit 1
fi
grep -F 'distribution gate blocker: canonical Homebrew tap formula is unavailable' "$fixture/missing-tap.error" >/dev/null

printf '%s\n' 'OK: verify-distribution contract passed'
