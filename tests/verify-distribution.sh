#!/usr/bin/env bash
set -euo pipefail

root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/build" "$fixture/scripts"
cp "$root/scripts/verify-distribution.sh" "$fixture/scripts/verify-distribution.sh"
chmod +x "$fixture/scripts/verify-distribution.sh"

assets=(ocstatusline-darwin-arm64 ocstatusline-darwin-x64 ocstatusline-linux-arm64 ocstatusline-linux-x64)
for asset in "${assets[@]}"; do printf '%s\n' "$asset" > "$fixture/build/$asset"; chmod +x "$fixture/build/$asset"; done
(cd "$fixture/build" && shasum -a 256 "${assets[@]}" > SHA256SUMS)
run_gate() { TAG=v1.2.3 bash "$fixture/scripts/verify-distribution.sh" "$@"; }
run_gate --check --tag v1.2.3 --version 1.2.3 >/dev/null

expect_fail() {
  if run_gate >"$fixture/stdout" 2>"$fixture/stderr"; then
    printf '%s\n' 'expected distribution gate failure' >&2
    exit 1
  fi
}

mv "$fixture/build/SHA256SUMS" "$fixture/build/SHA256SUMS.missing"
expect_fail
grep -F 'checksum manifest is unavailable' "$fixture/stderr" >/dev/null
mv "$fixture/build/SHA256SUMS.missing" "$fixture/build/SHA256SUMS"

rm "$fixture/build/ocstatusline-linux-x64"
expect_fail
grep -F 'missing or non-executable asset: ocstatusline-linux-x64' "$fixture/stderr" >/dev/null
printf '%s\n' ocstatusline-linux-x64 > "$fixture/build/ocstatusline-linux-x64"
chmod +x "$fixture/build/ocstatusline-linux-x64"

printf '%s\n' changed > "$fixture/build/ocstatusline-darwin-arm64"
expect_fail
grep -F 'manifest checksum mismatch' "$fixture/stderr" >/dev/null
printf '%s\n' ocstatusline-darwin-arm64 > "$fixture/build/ocstatusline-darwin-arm64"
chmod +x "$fixture/build/ocstatusline-darwin-arm64"

if TAG=v1.2 bash "$fixture/scripts/verify-distribution.sh" >"$fixture/stdout" 2>"$fixture/stderr"; then exit 1; fi
grep -F 'safe SemVer' "$fixture/stderr" >/dev/null

printf '%s\n' 'OK: verify-distribution contract passed'
