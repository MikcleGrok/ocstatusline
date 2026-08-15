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
      if [ "$1" = --tag ]; then tag_arg_set=true; tag=$2; fi
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

# The formula embeds each release asset's URL with Ruby's `v#{version}`
# string interpolation (idiomatic Homebrew style: one template, evaluated
# fresh per install) rather than a literal per-release URL. The shared
# verifier's prebuilt-profile URL check reads the formula as plain text and
# cannot evaluate Ruby, so it can never match a `#{version}` placeholder
# against a real tag. Render a throwaway copy with the placeholder
# substituted for the resolved version before verifying — the same
# render-before-verify fix uni-db applies for its own Ruby-templated
# formula (scripts/render-formula.sh).
formula="$root/Formula/ocstatusline.rb"
resolved_tag=${tag:-$(git -C "$root" describe --tags --exact-match 2>/dev/null || true)}
if [ -n "$resolved_tag" ]; then
  version=${resolved_tag#v}
  formula_tmp=$(mktemp "${TMPDIR:-/tmp}/ocstatusline-formula.XXXXXX.rb")
  trap 'rm -f "$formula_tmp"' EXIT
  sed "s/#{version}/${version}/g" "$formula" > "$formula_tmp"
  if command -v ruby >/dev/null 2>&1; then
    ruby -c "$formula_tmp" >/dev/null || { printf '%s\n' 'ERROR: rendered formula failed ruby syntax check' >&2; exit 1; }
  fi
  formula=$formula_tmp
fi

"$guide_tools_root/bin/guide-distribution-verify" "${safe_args[@]}" --profile prebuilt --root "$root" --formula "$formula" --source-url 'https://github.com' --manifest "$root/build/SHA256SUMS" --assets ocstatusline-darwin-arm64,ocstatusline-darwin-x64,ocstatusline-linux-arm64,ocstatusline-linux-x64
