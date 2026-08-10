#!/usr/bin/env bash
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
tag="${1:-$(git -C "$root" describe --tags --exact-match 2>/dev/null || true)}"
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$ ]] || { printf 'formula-check blocker: exact release tag required, got %s\n' "$tag" >&2; exit 1; }
version="${tag#v}"
formula="$root/Formula/ocstatusline.rb"
sums="$root/build/SHA256SUMS"
test -s "$formula" || { printf '%s\n' 'formula-check blocker: formula is missing' >&2; exit 1; }
test -s "$sums" || { printf '%s\n' 'formula-check blocker: build/SHA256SUMS is missing' >&2; exit 1; }
grep -F "version \"$version\"" "$formula" >/dev/null || { printf 'formula-check blocker: stale formula version expected=%s\n' "$version" >&2; exit 1; }
if command -v sha256sum >/dev/null 2>&1; then
  checksum() { sha256sum "$1" | awk '{ print $1 }'; }
elif command -v shasum >/dev/null 2>&1; then
  checksum() { shasum -a 256 "$1" | awk '{ print $1 }'; }
else
  printf '%s\n' 'formula-check blocker: neither sha256sum nor shasum is available' >&2
  exit 1
fi
for asset in ocstatusline-darwin-arm64 ocstatusline-darwin-x64 ocstatusline-linux-arm64 ocstatusline-linux-x64; do
  expected="$(awk -v name="$asset" '$2 == name { print $1 }' "$sums")"
  [[ "$expected" =~ ^[0-9a-fA-F]{64}$ ]] || { printf 'formula-check blocker: missing checksum for %s\n' "$asset" >&2; exit 1; }
  build_asset="$root/build/$asset"
  test -s "$build_asset" || { printf 'formula-check blocker: build asset is missing: %s\n' "$asset" >&2; exit 1; }
  built="$(checksum "$build_asset")"
  test "${built,,}" = "${expected,,}" || { printf 'formula-check blocker: manifest does not match build asset=%s expected=%s actual=%s\n' "$asset" "$expected" "$built" >&2; exit 1; }
  formula_hash="$(awk -v name="$asset" '
    /^[[:space:]]*url[[:space:]]+"/ && index($0, "/releases/download/v#{version}/" name "\"") {
      if (getline > 0) {
        hash = $0
        sub(/^.*sha256[[:space:]]+"/, "", hash)
        sub(/".*$/, "", hash)
        print hash
      }
      exit
    }
  ' "$formula")"
  test "${formula_hash,,}" = "${expected,,}" || { printf 'formula-check blocker: formula checksum mismatch asset=%s expected=%s actual=%s\n' "$asset" "$expected" "${formula_hash:-missing}" >&2; exit 1; }
done
printf 'formula-check: tag=%s version=%s all_assets=verified\n' "$tag" "$version"
