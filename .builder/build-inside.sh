#!/usr/bin/env bash
set -euo pipefail

VERSION="${VERSION:?VERSION must be set — make build/build-all export it}"
TARGETS="${TARGETS:-bun-darwin-arm64 bun-darwin-x64 bun-linux-x64 bun-linux-arm64}"
OUT_DIR="${OUT_DIR:-/out}"
EXTRA_FLAGS="${EXTRA_FLAGS:-}"

mkdir -p "$OUT_DIR"

# Copy source to a local directory inside the container to avoid bind-mount rename issues
SRC_DIR="/src"
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT

echo ">> copying source to $BUILD_DIR"
cp -r "$SRC_DIR"/* "$BUILD_DIR"/
cp "$SRC_DIR"/.env "$BUILD_DIR"/ 2>/dev/null || true

# Stamp version
printf 'export const VERSION = %s;\n' "\"${VERSION}\"" > "$BUILD_DIR/src/version.ts"
echo ">> stamped version with ${VERSION}"

# Install deps in build dir
echo ">> installing dependencies"
cd "$BUILD_DIR"
bun install --frozen-lockfile

for t in $TARGETS; do
    name="ocstatusline-${t#bun-}"
    echo ">> compiling ${name} (target ${t}, flags '${EXTRA_FLAGS}')"
    # shellcheck disable=SC2086
    bun build src/index.ts --compile --target="$t" $EXTRA_FLAGS --outfile "${OUT_DIR}/${name}"
done

echo ">> artifacts in ${OUT_DIR}:"
ls -l "$OUT_DIR"