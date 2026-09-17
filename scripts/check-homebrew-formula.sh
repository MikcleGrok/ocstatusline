#!/usr/bin/env bash
set -euo pipefail

root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
tag="${1:-$(git -C "$root" describe --tags --exact-match 2>/dev/null || true)}"
[[ "$tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || { printf 'formula-check blocker: regular release tag required, got %s\n' "$tag" >&2; exit 1; }
version="${tag#v}"
tap_dir="${HOMEBREW_TAP_DIR:-$root/../homebrew-mikclegrok-tools}"
test -n "${HOMEBREW_TAP_DIR:-}" || { printf '%s\n' 'formula-check blocker: HOMEBREW_TAP_DIR must explicitly point to the tap checkout' >&2; exit 1; }
formula="$tap_dir/Formula/ocstatusline.rb"
sums="$root/build/SHA256SUMS"
test -s "$formula" || { printf 'formula-check blocker: tap formula is missing: %s\n' "$formula" >&2; exit 1; }
test -s "$sums" || { printf '%s\n' 'formula-check blocker: build/SHA256SUMS is missing' >&2; exit 1; }
version_count="$(awk -v value="$version" '$0 ~ "^[[:space:]]*version[[:space:]]+\"" value "\"[[:space:]]*$" { count++ } END { print count + 0 }' "$formula")"
test "$version_count" = 1 || { printf 'formula-check blocker: Formula must contain one anchored version instruction expected=%s\n' "$version" >&2; exit 1; }

if awk '/^[[:space:]]*head([[:space:]]|$)/ || /^[[:space:]]*url[[:space:]]+.*--HEAD/ { found = 1 } END { exit !found }' "$formula"; then
  printf '%s\n' 'formula-check blocker: stable Formula must not use head or --HEAD' >&2
  exit 1
fi
formula_url_count="$(awk '/^[[:space:]]*url[[:space:]]+"[^"]+"[[:space:]]*$/ { count++ } END { print count + 0 }' "$formula")"
test "$formula_url_count" = 4 || { printf 'formula-check blocker: Formula must contain exactly four anchored asset URLs\n' >&2; exit 1; }

if command -v sha256sum >/dev/null 2>&1; then checksum() { sha256sum "$1" | awk '{ print $1 }'; }
elif command -v shasum >/dev/null 2>&1; then checksum() { shasum -a 256 "$1" | awk '{ print $1 }'; }
else printf '%s\n' 'formula-check blocker: neither sha256sum nor shasum is available' >&2; exit 1; fi

for asset in ocstatusline-darwin-arm64 ocstatusline-darwin-x64 ocstatusline-linux-arm64 ocstatusline-linux-x64; do
  url="https://github.com/MikcleGrok/ocstatusline/releases/download/v${version}/$asset"
  pair="$(awk -v target="$url" '
    /^[[:space:]]*url[[:space:]]+"[^"]+"[[:space:]]*$/ {
      line = $0
      sub(/^[[:space:]]*url[[:space:]]+"/, "", line)
      sub(/"[[:space:]]*$/, "", line)
      if (line == target) {
        count++
        if (getline next_line > 0 && next_line ~ /^[[:space:]]*sha256[[:space:]]+"[0-9A-Fa-f]{64}"[[:space:]]*$/) {
          hash = next_line
          sub(/^[[:space:]]*sha256[[:space:]]+"/, "", hash)
          sub(/"[[:space:]]*$/, "", hash)
        } else { invalid = 1 }
      }
    }
    END { print count + 0, hash, invalid + 0 }
  ' "$formula")"
  read -r url_count formula_hash invalid_pair <<EOF
$pair
EOF
  test "$url_count" = 1 && test "$invalid_pair" = 0 || { printf 'formula-check blocker: non-canonical or malformed URL/checksum pair for %s\n' "$asset" >&2; exit 1; }
  expected="$(awk -v name="$asset" '$2 == name { print $1 }' "$sums")"
  [[ "$expected" =~ ^[0-9a-fA-F]{64}$ ]] || { printf 'formula-check blocker: missing checksum for %s\n' "$asset" >&2; exit 1; }
  build_asset="$root/build/$asset"
  test -s "$build_asset" || { printf 'formula-check blocker: build asset is missing: %s\n' "$asset" >&2; exit 1; }
  built="$(checksum "$build_asset")"
  test "$(printf '%s' "$built" | tr '[:upper:]' '[:lower:]')" = "$(printf '%s' "$expected" | tr '[:upper:]' '[:lower:]')" || { printf 'formula-check blocker: manifest does not match build asset=%s\n' "$asset" >&2; exit 1; }
  test "$(printf '%s' "$formula_hash" | tr '[:upper:]' '[:lower:]')" = "$(printf '%s' "$expected" | tr '[:upper:]' '[:lower:]')" || { printf 'formula-check blocker: formula checksum mismatch asset=%s\n' "$asset" >&2; exit 1; }
done
printf 'formula-check: tag=%s version=%s all_assets=verified\n' "$tag" "$version"
