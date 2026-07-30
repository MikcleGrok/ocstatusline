#!/usr/bin/env sh
set -uo pipefail
cd /src

SERVER="${OCSL_SERVER:-http://mock-opencode:4096}"
OUT=/tmp/dev.out
ERR=/tmp/dev.err

echo ">> bun run src/index.ts start --server ${SERVER} (6s)"
timeout 6s bun run src/index.ts start --server "$SERVER" > "$OUT" 2> "$ERR"
echo "   daemon rc=$?"
echo "--- stdout ---"
cat -v "$OUT"
echo
echo "--- stderr ---"
cat "$ERR"

if ! grep -qF qwen3-coder "$OUT"; then
    echo "FAIL: no rendered status line — the SDK never received the mock's events"
    exit 1
fi
echo "OK: mock-check passed"