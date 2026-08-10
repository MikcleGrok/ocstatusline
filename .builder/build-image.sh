#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || cp .env.dist .env
set -a
. ./.env
set +a

: "${BUN_BASE_IMAGE_REF:=$(grep -E '^BUN_BASE_IMAGE_REF=' .env.dist | cut -d= -f2-)}"

BASETAG="$(bash .builder/basetag.sh)"
image="${IMAGE_NAME}:${BASETAG}"

if [ -n "$(docker images -q "$image")" ]; then
    echo ">> toolchain image $image already present"
    exit 0
fi

echo ">> building toolchain image $image (bun ${BUN_VERSION})"
docker build \
    -f .builder/base.dockerfile \
    --build-arg "BUN_BASE_IMAGE_REF=${BUN_BASE_IMAGE_REF}" \
    -t "$image" \
    .
echo ">> built $image"
