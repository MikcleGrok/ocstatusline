#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.." >/dev/null

env_file=.env
[ -f "$env_file" ] || env_file=.env.dist
bun_version="$(grep -E '^BUN_VERSION=' "$env_file" | head -1 | cut -d= -f2-)"

files=(.builder/base.dockerfile)
[ -f bun.lock ] && files+=(bun.lock)

{ cat "${files[@]}" 2>/dev/null; echo "$bun_version"; } | git hash-object --stdin 2>/dev/null | cut -c1-16