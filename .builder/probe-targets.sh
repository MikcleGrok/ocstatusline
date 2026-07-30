#!/usr/bin/env bash
set -uo pipefail
cd /src

CANDIDATES="${CANDIDATES:-bun-darwin-arm64 bun-darwin-x64 bun-linux-x64 bun-linux-arm64 bun-linux-x64-musl bun-linux-arm64-musl bun-windows-x64}"

probe=/tmp/probe.ts
echo 'console.log("probe");' > "$probe"

supported=""
unsupported=""

for t in $CANDIDATES; do
    if bun build "$probe" --compile --target="$t" --outfile "/tmp/probe-$t" >"/tmp/probe-$t.log" 2>&1; then
        supported="$supported $t"
        printf 'SUPPORTED    %s\n' "$t"
    else
        unsupported="$unsupported $t"
        printf 'UNSUPPORTED  %-24s %s\n' "$t" "$(grep -m1 -i 'error' "/tmp/probe-$t.log" | tr -d '\r')"
    fi
done

echo
echo "SUPPORTED_TARGETS:$supported"
echo "UNSUPPORTED_TARGETS:$unsupported"
echo "BUN_VERSION:$(bun --version)"