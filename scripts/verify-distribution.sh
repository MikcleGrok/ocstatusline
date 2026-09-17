#!/usr/bin/env bash
set -euo pipefail

root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P)"
manifest="$root/build/SHA256SUMS"
tag="${TAG:-$(git -C "$root" describe --tags --exact-match 2>/dev/null || true)}"
tag_pattern='^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
version_pattern='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
assets=(ocstatusline-darwin-arm64 ocstatusline-darwin-x64 ocstatusline-linux-arm64 ocstatusline-linux-x64)
requested_version=""
requested_tag=""

while test "$#" -gt 0; do
  case "$1" in
    --check) shift ;;
    --tag|--version)
      test "$#" -ge 2 || { printf 'ERROR: %s requires a value\n' "$1" >&2; exit 2; }
      if [ "$1" = --tag ]; then requested_tag="$2"; else requested_version="$2"; fi
      shift 2
      ;;
    *) printf 'ERROR: unsupported wrapper argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

test -n "$tag" && [[ "$tag" =~ $tag_pattern ]] || { printf 'ERROR: TAG must be a safe SemVer vMAJOR.MINOR.PATCH\n' >&2; exit 1; }
if [ -n "$requested_tag" ]; then
  [[ "$requested_tag" =~ $tag_pattern ]] || { printf 'ERROR: --tag must be a safe SemVer vMAJOR.MINOR.PATCH\n' >&2; exit 1; }
  test "$requested_tag" = "$tag" || { printf 'ERROR: --tag does not match TAG: expected=%s actual=%s\n' "$tag" "$requested_tag" >&2; exit 1; }
fi
version="${tag#v}"
if [ -n "$requested_version" ]; then
  [[ "$requested_version" =~ $version_pattern ]] || { printf 'ERROR: --version must be a safe SemVer MAJOR.MINOR.PATCH without a v prefix\n' >&2; exit 1; }
  test "$requested_version" = "$version" || { printf 'ERROR: --version does not match tag: expected=%s actual=%s\n' "$version" "$requested_version" >&2; exit 1; }
fi

test -s "$manifest" || { printf 'distribution gate blocker: checksum manifest is unavailable: %s\n' "$manifest" >&2; exit 1; }
manifest_valid="$(awk '
  NF != 2 || $1 !~ /^[0-9A-Fa-f]{64}$/ || $2 !~ /^ocstatusline-(darwin-arm64|darwin-x64|linux-arm64|linux-x64)$/ { bad = 1 }
  { count++ }
  END { print (!bad && count == 4) ? "yes" : "no" }
' "$manifest")"
test "$manifest_valid" = yes || { printf '%s\n' 'distribution gate blocker: manifest must contain exactly four valid asset checksums' >&2; exit 1; }

for asset in "${assets[@]}"; do
  manifest_count="$(awk -v name="$asset" '$2 == name { count++ } END { print count + 0 }' "$manifest")"
  test "$manifest_count" = 1 || { printf 'distribution gate blocker: manifest must contain one checksum for %s\n' "$asset" >&2; exit 1; }
done

checksum() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}';
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}';
  else printf '%s\n' 'distribution gate blocker: neither sha256sum nor shasum is available' >&2; exit 1; fi
}

for asset in "${assets[@]}"; do
  build_asset="$root/build/$asset"
  test -x "$build_asset" || { printf 'distribution gate blocker: missing or non-executable asset: %s\n' "$asset" >&2; exit 1; }
  expected="$(awk -v name="$asset" '$2 == name { print $1 }' "$manifest")"
  [[ "$expected" =~ ^[0-9a-fA-F]{64}$ ]] || { printf 'distribution gate blocker: missing checksum for %s\n' "$asset" >&2; exit 1; }
  actual="$(checksum "$build_asset")"
  test "$(printf '%s' "$actual" | tr '[:upper:]' '[:lower:]')" = "$(printf '%s' "$expected" | tr '[:upper:]' '[:lower:]')" || { printf 'distribution gate blocker: manifest checksum mismatch for %s\n' "$asset" >&2; exit 1; }
done
printf 'distribution-check: tag=%s version=%s all_assets=verified\n' "$tag" "$version"
