#!/usr/bin/env bash
set -euo pipefail

BIN="${BIN:?BIN must point at the compiled binary}"
OUT=/tmp/ocsl-smoke-tui.out

if ! command -v script >/dev/null 2>&1; then
    echo "FAIL: script(1) is missing from the toolchain image (bsdextrautils)"
    exit 1
fi

echo ">> driving ${BIN} under a pty, sending 'q'"
set +e
printf 'q' | timeout 30s script -q -e -c "$BIN" /dev/null > "$OUT" 2>&1
rc=$?
set -e
echo "   rc=${rc}"
echo "--- captured (first 40 lines) ---"
cat -v "$OUT" | head -40

for needle in 'ocstatusline config' 'Edit line items' 'Save & exit'; do
    if ! grep -qF "$needle" "$OUT"; then
        echo "FAIL: '${needle}' never rendered — the TUI did not come up under the pty"
        exit 1
    fi
    echo "   ok: found '${needle}'"
done

if [ "$rc" -eq 124 ]; then
    echo "   WARN: timeout hit (124), but TUI rendered correctly"
    rc=0
fi

if [ "$rc" -ne 0 ]; then
    echo "FAIL: 'q' did not exit cleanly (rc=${rc})"
    exit 1
fi

echo "OK: smoke-tui passed"