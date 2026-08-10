#!/usr/bin/env bash
set -euo pipefail
tag=${TAG:-}
if [ -n "$tag" ] && ! [[ "$tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  printf '%s\n' 'ERROR: TAG must be a safe SemVer vMAJOR.MINOR.PATCH' >&2
  exit 1
fi
safe_args=()
tag_arg_set=false
while test "$#" -gt 0; do
  case "$1" in
    --tag|--version|--format|--output)
      test "$#" -ge 2 || { printf '%s\n' "$1 requires a value" >&2; exit 2; }
      if [ "$1" = --tag ] || [ "$1" = --version ]; then
        [[ "$2" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || { printf '%s\n' "ERROR: $1 must be a safe SemVer vMAJOR.MINOR.PATCH" >&2; exit 1; }
      fi
      [ "$1" = --tag ] && tag_arg_set=true
      safe_args+=("$1" "$2"); shift 2;;
    --check|--help|-h) safe_args+=("$1"); shift;;
    *) printf 'ERROR: unsupported wrapper argument: %s\n' "$1" >&2; exit 2;;
  esac
done
if [ -n "$tag" ] && ! $tag_arg_set; then
  safe_args+=(--tag "$tag")
fi
root=$(cd -- "$(dirname -- "$0")/.." && pwd)
guide_tools_root=${GUIDE_TOOLS_ROOT:-$(cd -- "$root/../guide-tools" && pwd)}
exec "$guide_tools_root/bin/guide-distribution-verify" "${safe_args[@]}" --profile prebuilt --root "$root" --formula "$root/Formula/ocstatusline.rb" --manifest "$root/build/SHA256SUMS" --assets ocstatusline-darwin-arm64,ocstatusline-darwin-x64,ocstatusline-linux-arm64,ocstatusline-linux-x64
