#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.." >/dev/null

env_file=.env
[ -f "$env_file" ] || env_file=.env.dist
toolchain_ref="$(grep -E '^BUN_(VERSION|BASE_IMAGE_REF)=' "$env_file" | head -2)"
if ! grep -q '^BUN_BASE_IMAGE_REF=' "$env_file"; then
    toolchain_ref="${toolchain_ref}"$'\n'"$(grep -E '^BUN_BASE_IMAGE_REF=' .env.dist)"
fi

files=(.builder/base.dockerfile)
[ -f bun.lock ] && files+=(bun.lock)

{ cat "${files[@]}" 2>/dev/null; echo "$toolchain_ref"; } | git hash-object --stdin 2>/dev/null | cut -c1-16
