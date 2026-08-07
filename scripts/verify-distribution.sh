#!/usr/bin/env bash
set -euo pipefail
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
guide_tools_root=${GUIDE_TOOLS_ROOT:-$(CDPATH= cd -- "$root/../guide-tools" && pwd)}
safe_args=()
while test "$#" -gt 0; do
  case "$1" in
    --tag|--version|--format|--output) test "$#" -ge 2 || { printf '%s\n' "$1 requires a value" >&2; exit 2; }; safe_args+=("$1" "$2"); shift 2;;
    --check|--help|-h) safe_args+=("$1"); shift;;
    *) printf 'ERROR: unsupported wrapper argument: %s\n' "$1" >&2; exit 2;;
  esac
done
exec "$guide_tools_root/bin/guide-distribution-verify" "${safe_args[@]}" --profile prebuilt --root "$root" --formula "$root/Formula/ocstatusline.rb" --manifest "$root/build/SHA256SUMS" --assets ocstatusline-darwin-arm64,ocstatusline-darwin-x64,ocstatusline-linux-arm64,ocstatusline-linux-x64
