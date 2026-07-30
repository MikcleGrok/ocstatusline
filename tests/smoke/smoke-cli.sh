#!/usr/bin/env bash
set -euo pipefail

BIN="${BIN:?BIN must point at the compiled binary}"
EXPECTED_VERSION="${EXPECTED_VERSION:?EXPECTED_VERSION must be set}"

echo ">> the toolchain must be absent from this image"
if command -v bun >/dev/null 2>&1 || command -v node >/dev/null 2>&1; then
    echo "FAIL: bun or node is present — this smoke would prove nothing"
    exit 1
fi
echo "   ok: no bun, no node"

echo ">> ${BIN} --version"
got="$("$BIN" --version)"
echo "   got: ${got}"
if [ "$got" != "$EXPECTED_VERSION" ]; then
    echo "FAIL: expected ${EXPECTED_VERSION}"
    exit 1
fi

echo ">> no-TTY run with no arguments"
set +e
out="$("$BIN" < /dev/null 2>&1)"
rc=$?
set -e
echo "   rc=${rc}"
echo "   out=${out}"
if [ "$rc" -ne 0 ]; then
    echo "FAIL: expected exit code 0"
    exit 1
fi
case "$out" in
    *"needs an interactive terminal"*) ;;
    *) echo "FAIL: expected the interactive-terminal message"; exit 1 ;;
esac

echo "OK: smoke-cli passed"