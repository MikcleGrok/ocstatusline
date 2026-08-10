#!/usr/bin/env bash
set -euo pipefail

TAG="${TAG:-}"
VERSION="${VERSION:-}"
[[ "$TAG" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || { echo "ERROR: invalid release tag" >&2; exit 1; }
[[ "$VERSION" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || { echo "ERROR: invalid release version" >&2; exit 1; }
OUT_DIR="dist/local-release/${VERSION}"
COMMIT="$(git rev-parse HEAD)"
BUILT_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
SOURCE_ARCHIVE="ocstatusline-${VERSION#v}-source.tar.gz"

if command -v sha256sum >/dev/null 2>&1; then
  checksum() { sha256sum "$@"; }
elif command -v shasum >/dev/null 2>&1; then
  checksum() { shasum -a 256 "$@"; }
else
  echo "ERROR: neither sha256sum nor shasum is available; cannot create SHA-256 checksums" >&2
  exit 1
fi

STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ocstatusline-release.XXXXXX")"
trap 'rm -rf "$STAGING_DIR"' EXIT
mkdir -p "$STAGING_DIR"
if [ -e "$OUT_DIR" ]; then
  echo "ERROR: release output already exists: $OUT_DIR (remove it explicitly before retrying)" >&2
  exit 1
fi

for artifact in build/ocstatusline-darwin-arm64 build/ocstatusline-darwin-x64 build/ocstatusline-linux-arm64 build/ocstatusline-linux-x64; do
  test -x "$artifact" || { echo "ERROR: missing or non-executable artifact: $artifact" >&2; exit 1; }
  cp "$artifact" "$STAGING_DIR/"
done

git archive --format=tar --prefix="ocstatusline-${VERSION#v}/" "$TAG" | gzip -n > "$STAGING_DIR/$SOURCE_ARCHIVE"

(
  cd "$STAGING_DIR"
  checksum ocstatusline-darwin-arm64 ocstatusline-darwin-x64 ocstatusline-linux-arm64 ocstatusline-linux-x64 "$SOURCE_ARCHIVE" > SHA256SUMS
)

SOURCE_SHA256="$(checksum "$STAGING_DIR/$SOURCE_ARCHIVE" | cut -d ' ' -f 1)"
ARTIFACTS_JSON=""
for artifact in ocstatusline-darwin-arm64 ocstatusline-darwin-x64 ocstatusline-linux-arm64 ocstatusline-linux-x64; do
  checksum="$(checksum "$STAGING_DIR/$artifact" | cut -d ' ' -f 1)"
  [ -n "$ARTIFACTS_JSON" ] && ARTIFACTS_JSON+=', '
  ARTIFACTS_JSON+="{\"name\":\"$artifact\",\"sha256\":\"$checksum\"}"
done

cat > "$STAGING_DIR/manifest.json" <<EOF
{
  "version": "$VERSION",
  "tag": "$TAG",
  "commit": "$COMMIT",
  "built_at": "$BUILT_AT",
  "artifacts": [$ARTIFACTS_JSON],
  "source": {"name": "$SOURCE_ARCHIVE", "sha256": "$SOURCE_SHA256"}
}
EOF

{
  printf '# Release %s\n\n' "$TAG"
  printf '%s%s%s\n\n' 'Built locally from commit `' "$COMMIT" '`. This directory is self-contained and is not published automatically.'
  printf '## Changes\n\n'
  git log --format='- %s (%h)' "$TAG^..$TAG" 2>/dev/null || printf '%s\n' '- No commit range available.'
  printf "\n## Artifacts\n\n- Binaries for the four supported Bun targets\n- Deterministic source archive: \`%s\`\n- SHA256 checksums: \`SHA256SUMS\`\n- Machine-readable metadata: \`manifest.json\`\n" "$SOURCE_ARCHIVE"
 } > "$STAGING_DIR/release-notes.md"

mkdir -p "$(dirname "$OUT_DIR")"
mv "$STAGING_DIR" "$OUT_DIR"
trap - EXIT
echo ">> local release written to $OUT_DIR"
ls -l "$OUT_DIR"
