#!/usr/bin/env bash
set -euo pipefail

root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
workflow="$root/.github/workflows/release.yml"
grep -F "tags:" "$workflow" >/dev/null
grep -F -- "- 'v*'" "$workflow" >/dev/null
grep -F 'workflow_dispatch:' "$workflow" >/dev/null
grep -F "REF_TYPE: \${{ github.ref_type }}" "$workflow" >/dev/null
grep -F "test \"\$REF_TYPE\" = tag" "$workflow" >/dev/null
grep -F 'RELEASE_TAG" =~ ^v' "$workflow" >/dev/null
grep -F "group: release-\${{ github.repository }}-\${{ github.ref_name }}" "$workflow" >/dev/null
grep -F 'cancel-in-progress: false' "$workflow" >/dev/null
grep -F 'contents: write' "$workflow" >/dev/null
grep -F 'fetch-depth: 0' "$workflow" >/dev/null
grep -F 'run: make release' "$workflow" >/dev/null
grep -F 'build/ocstatusline-linux-x64 --version' "$workflow" >/dev/null
grep -F 'GITHUB_REF_NAME' "$workflow" >/dev/null
grep -F 'github.repository' "$workflow" >/dev/null
for asset in ocstatusline-darwin-arm64 ocstatusline-darwin-x64 ocstatusline-linux-arm64 ocstatusline-linux-x64 build/SHA256SUMS; do grep -F "$asset" "$workflow" >/dev/null; done
grep -F 'if: always()' "$workflow" >/dev/null
if grep -Eiq 'MikcleGrok/tools|guide-tools|GUIDE_TOOLS_ROOT|homebrew|HOMEBREW_TAP_DIR' "$workflow"; then exit 1; fi
guard_line="$(grep -n 'name: Validate release ref' "$workflow" | cut -d: -f1)"
build_line="$(grep -n 'run: make release' "$workflow" | cut -d: -f1)"
test "$guard_line" -lt "$build_line"
printf '%s\n' 'OK: release workflow contract passed'
