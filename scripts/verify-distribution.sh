#!/usr/bin/env bash
set -euo pipefail
tag=${TAG:-}
tag_pattern='^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
version_pattern='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
if [ -n "$tag" ] && ! [[ "$tag" =~ $tag_pattern ]]; then
  printf '%s\n' 'ERROR: TAG must be a safe SemVer vMAJOR.MINOR.PATCH' >&2
  exit 1
fi
safe_args=()
tag_arg_set=false
while test "$#" -gt 0; do
  case "$1" in
    --tag|--version|--format|--output)
      test "$#" -ge 2 || { printf '%s\n' "$1 requires a value" >&2; exit 2; }
      if [ "$1" = --tag ]; then
        [[ "$2" =~ $tag_pattern ]] || { printf '%s\n' "ERROR: $1 must be a safe SemVer vMAJOR.MINOR.PATCH" >&2; exit 1; }
      elif [ "$1" = --version ]; then
        [[ "$2" =~ $version_pattern ]] || { printf '%s\n' "ERROR: $1 must be a safe SemVer MAJOR.MINOR.PATCH without a v prefix" >&2; exit 1; }
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
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P)
guide_tools_root=${GUIDE_TOOLS_ROOT:-$root/../guide-tools}
tap_dir=${HOMEBREW_TAP_DIR:-$root/../homebrew-mikclegrok-tools}
verifier="$guide_tools_root/bin/guide-distribution-verify"
formula="$tap_dir/Formula/ocstatusline.rb"
if [ ! -x "$verifier" ]; then
  printf 'distribution gate blocker: guide-distribution-verify is unavailable: %s\n' "$verifier" >&2
  printf 'set GUIDE_TOOLS_ROOT to a checkout containing the canonical verifier\n' >&2
  exit 1
fi
if [ ! -s "$formula" ]; then
  printf 'distribution gate blocker: canonical Homebrew tap formula is unavailable: %s\n' "$formula" >&2
  printf 'set HOMEBREW_TAP_DIR to the checked-out homebrew-mikclegrok-tools tap\n' >&2
  exit 1
fi
exec "$verifier" "${safe_args[@]}" --profile prebuilt --root "$root" --formula "$formula" --source-url https://github.com/MikcleGrok/ocstatusline --manifest "$root/build/SHA256SUMS" --assets ocstatusline-darwin-arm64,ocstatusline-darwin-x64,ocstatusline-linux-arm64,ocstatusline-linux-x64
