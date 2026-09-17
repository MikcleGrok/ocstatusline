#!/usr/bin/env bash
set -euo pipefail

root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

mkdir -p "$fixture/build" "$fixture/tap/Formula" "$fixture/scripts"
cp "$root/scripts/check-homebrew-formula.sh" "$fixture/scripts/check-homebrew-formula.sh"
chmod +x "$fixture/scripts/check-homebrew-formula.sh"

cat > "$fixture/tap/Formula/ocstatusline.rb" <<'FORMULA'
class Ocstatusline < Formula
  version "1.2.3"
  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/MikcleGrok/ocstatusline/releases/download/v1.2.3/ocstatusline-darwin-arm64"
      sha256 "HASH_DARWIN_ARM64"
    else
      url "https://github.com/MikcleGrok/ocstatusline/releases/download/v1.2.3/ocstatusline-darwin-x64"
      sha256 "HASH_DARWIN_X64"
    end
  end
  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/MikcleGrok/ocstatusline/releases/download/v1.2.3/ocstatusline-linux-arm64"
      sha256 "HASH_LINUX_ARM64"
    else
      url "https://github.com/MikcleGrok/ocstatusline/releases/download/v1.2.3/ocstatusline-linux-x64"
      sha256 "HASH_LINUX_X64"
    end
  end
end
FORMULA

for asset in ocstatusline-darwin-arm64 ocstatusline-darwin-x64 ocstatusline-linux-arm64 ocstatusline-linux-x64; do
  printf '%s\n' "$asset" > "$fixture/build/$asset"
done

(
  cd "$fixture/build"
  shasum -a 256 ocstatusline-* > SHA256SUMS
)

formula="$fixture/tap/Formula/ocstatusline.rb"
formula_hashes=()
for asset in ocstatusline-darwin-arm64 ocstatusline-darwin-x64 ocstatusline-linux-arm64 ocstatusline-linux-x64; do
  formula_hashes+=("$(awk -v name="$asset" '$2 == name { print $1 }' "$fixture/build/SHA256SUMS")")
done
sed -e "s/HASH_DARWIN_ARM64/${formula_hashes[0]}/" -e "s/HASH_DARWIN_X64/${formula_hashes[1]}/" -e "s/HASH_LINUX_ARM64/${formula_hashes[2]}/" -e "s/HASH_LINUX_X64/${formula_hashes[3]}/" "$formula" > "$formula.tmp"
mv "$formula.tmp" "$formula"
cp "$formula" "$fixture/formula.good"

HOMEBREW_TAP_DIR="$fixture/tap" bash "$fixture/scripts/check-homebrew-formula.sh" v1.2.3 >/dev/null

if bash "$fixture/scripts/check-homebrew-formula.sh" v1.2.3 >/dev/null 2> "$fixture/missing-tap-dir-error"; then
  printf '%s\n' 'expected formula checker to require an explicit tap directory' >&2
  exit 1
fi
grep -F 'HOMEBREW_TAP_DIR must explicitly point' "$fixture/missing-tap-dir-error" >/dev/null

sed 's#url "https://github.com/MikcleGrok/ocstatusline/releases/download#note "https://github.com/MikcleGrok/ocstatusline/releases/download#' "$formula" > "$formula.tmp"
mv "$formula.tmp" "$formula"
if HOMEBREW_TAP_DIR="$fixture/tap" bash "$fixture/scripts/check-homebrew-formula.sh" v1.2.3 >/dev/null 2> "$fixture/decoy-error"; then
  printf '%s\n' 'expected formula checker to reject a non-instruction URL decoy' >&2
  exit 1
fi
grep -E 'non-canonical|URL/checksum pair|exactly four anchored asset URLs' "$fixture/decoy-error" >/dev/null
sed 's#note "https://github.com/MikcleGrok/ocstatusline/releases/download#url "https://github.com/MikcleGrok/ocstatusline/releases/download#' "$formula" > "$formula.tmp"
mv "$formula.tmp" "$formula"

sed 's#MikcleGrok/ocstatusline#MikcleGrok/tools#g' "$formula" > "$formula.tmp"
mv "$formula.tmp" "$formula"
if HOMEBREW_TAP_DIR="$fixture/tap" bash "$fixture/scripts/check-homebrew-formula.sh" v1.2.3 >/dev/null 2> "$fixture/source-error"; then
  printf '%s\n' 'expected formula checker to reject old tools URL' >&2
  exit 1
fi
grep -E 'non-canonical|URL/checksum pair' "$fixture/source-error" >/dev/null
sed 's#MikcleGrok/tools#MikcleGrok/ocstatusline#g' "$formula" > "$formula.tmp"
mv "$formula.tmp" "$formula"

printf '%s\n' '  url "https://github.com/MikcleGrok/tools/releases/download/v#{version}/legacy"' >> "$formula"
if HOMEBREW_TAP_DIR="$fixture/tap" bash "$fixture/scripts/check-homebrew-formula.sh" v1.2.3 >/dev/null 2> "$fixture/extra-url-error"; then
  printf '%s\n' 'expected formula checker to reject an extra old-tools URL' >&2
  exit 1
fi
grep -F 'exactly four anchored asset URLs' "$fixture/extra-url-error" >/dev/null
sed -i '$d' "$formula"

sed "0,/${formula_hashes[0]}/s//0000000000000000000000000000000000000000000000000000000000000000/" "$fixture/formula.good" > "$formula"
if HOMEBREW_TAP_DIR="$fixture/tap" bash "$fixture/scripts/check-homebrew-formula.sh" v1.2.3 >/dev/null 2> "$fixture/association-error"; then
  printf '%s\n' 'expected formula checker to reject a mismatched checksum association' >&2
  exit 1
fi
grep -F 'formula checksum mismatch asset=ocstatusline-darwin-arm64' "$fixture/association-error" >/dev/null
cp "$fixture/formula.good" "$formula"

printf '%s\n' changed > "$fixture/build/ocstatusline-darwin-arm64"
if HOMEBREW_TAP_DIR="$fixture/tap" bash "$fixture/scripts/check-homebrew-formula.sh" v1.2.3 2> "$fixture/error"; then
  printf '%s\n' 'expected formula checker to reject changed asset' >&2
  exit 1
fi
grep -F 'manifest does not match build asset=ocstatusline-darwin-arm64' "$fixture/error" >/dev/null
