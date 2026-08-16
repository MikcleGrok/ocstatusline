#!/usr/bin/env bash
set -euo pipefail

# Proves `ocstatusline install` works from the compiled binary in the
# environment a Homebrew user actually has: no repo checkout, no toolchain.
# The plugin files must come out of the binary's embedded copy, and the
# install must stop -- loudly and for the right reason -- at the one step
# this image genuinely cannot do (npm).

BIN="${BIN:?BIN must point at the compiled binary}"
FAKE_HOME=/tmp/ocstatusline-smoke-home

echo ">> the toolchain must be absent from this image"
if command -v bun >/dev/null 2>&1 || command -v node >/dev/null 2>&1; then
    echo "FAIL: bun or node is present — this smoke would prove nothing"
    exit 1
fi
if command -v npm >/dev/null 2>&1; then
    echo "FAIL: npm is present — this smoke expects the install to stop at the npm step;"
    echo "      if the image gained a node toolchain, rewrite these expectations"
    exit 1
fi
echo "   ok: no bun, no node, no npm"

rm -rf "$FAKE_HOME"
mkdir -p "$FAKE_HOME"
CFG="${FAKE_HOME}/.config/opencode"

echo ">> ${BIN} install (HOME=${FAKE_HOME})"
set +e
out="$(env -u XDG_CONFIG_HOME HOME="$FAKE_HOME" "$BIN" install 2>&1)"
rc=$?
set -e
echo "   rc=${rc}"
echo "   out=${out}"

if [ "$rc" -eq 0 ]; then
    echo "FAIL: expected a non-zero exit — npm is not installed in this image"
    exit 1
fi
case "$out" in
    *"npm install failed"*) ;;
    *) echo "FAIL: expected the install to fail at the npm step"; exit 1 ;;
esac
# The give-away that the embedded fallback never ran: the binary would have
# surfaced the missing-checkout guard instead of getting as far as npm.
case "$out" in
    *"checked-out copy"*) echo "FAIL: the missing-checkout guard escaped — the embedded fallback did not run"; exit 1 ;;
    *) ;;
esac

echo ">> the plugin closure must have been written from the embedded copy"
for f in tui-plugins/ocstatusline.ts src/tui/footer.ts src/tui/openrouter-subprocess.ts src/data/git.ts src/data/openrouter-weekly.ts src/types/index.ts src/utils/config.ts; do
    if [ ! -s "${CFG}/${f}" ]; then
        echo "FAIL: ${CFG}/${f} is missing or empty"
        exit 1
    fi
done
echo "   ok: 7 files"

echo ">> the copied plugin entry must carry configDir-relative imports"
if ! grep -q "from '../src/tui/footer.js'" "${CFG}/tui-plugins/ocstatusline.ts"; then
    echo "FAIL: the import rewrite is missing from the installed plugin entry"
    exit 1
fi
if grep -q "from '../../src/" "${CFG}/tui-plugins/ocstatusline.ts"; then
    echo "FAIL: the installed plugin entry still has repo-relative imports"
    exit 1
fi

echo ">> package.json must carry the pinned plugin dependencies"
if ! grep -q '"@opentui/core"' "${CFG}/package.json"; then
    echo "FAIL: ${CFG}/package.json is missing the dependency pins"
    exit 1
fi

echo ">> tui.json must NOT exist: a failed install never registers the plugin"
if [ -e "${CFG}/tui.json" ]; then
    echo "FAIL: ${CFG}/tui.json was written despite the failed npm install"
    exit 1
fi

echo "OK: smoke-install passed"
