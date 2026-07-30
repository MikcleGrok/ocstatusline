#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || cp .env.dist .env
set -a
. ./.env
set +a

BASETAG="$(bash .builder/basetag.sh)"
image="${IMAGE_NAME}:${BASETAG}"

if [ -n "$(docker images -q "$image")" ]; then
    echo ">> toolchain image $image already present"
    exit 0
fi

echo ">> building toolchain image $image (bun ${BUN_VERSION})"
docker build \
    -f .builder/base.dockerfile \
    --build-arg "BUN_VERSION=${BUN_VERSION}" \
    -t "$image" \
    .
echo ">> built $image"