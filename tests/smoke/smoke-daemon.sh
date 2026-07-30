#!/usr/bin/env bash
set -euo pipefail

BIN="${BIN:?BIN must point at the compiled binary}"
SERVER="${SERVER:?SERVER must be the mock base url}"
OUT=/tmp/ocsl-smoke-daemon.out
ERR=/tmp/ocsl-smoke-daemon.err

echo ">> ${BIN} start --server ${SERVER} (5s)"
set +e
timeout 5s "$BIN" start --server "$SERVER" > "$OUT" 2> "$ERR"
rc=$?
set -e
echo "   rc=${rc}"
echo "--- stdout ---"
cat -v "$OUT"
echo
echo "--- stderr ---"
cat "$ERR"

needle1="qwen3-coder"
needle2="\$0.01"
if ! grep -qF "$needle1" "$OUT"; then
    echo "FAIL: ${needle1} missing from the rendered line"
    exit 1
fi
printf "   ok: found %s\n" "${needle1}"
if ! grep -qF "$needle2" "$OUT"; then
    echo "FAIL: ${needle2} missing from the rendered line"
    exit 1
fi
printf "   ok: found %s\n" "${needle2}"

echo "OK: smoke-daemon passed"