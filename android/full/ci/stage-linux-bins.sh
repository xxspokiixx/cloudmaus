#!/usr/bin/env bash
# Fetches the current Termux aarch64 debs, checks their sha256, and compiles
# omb-guest-chromium with NDK r30. proot comes from that current deb; its bytes
# differ from the binary that was tested on the phone.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
DEST="$ROOT/android/full/runtime/android-arm64/linux"
NDK="${NDK_ROOT:-$HOME/android-ndk-r30}"
WORK="${RUNNER_TEMP:-/tmp}/termux-debs"
mkdir -p "$DEST" "$WORK"
bash "$ROOT/android/full/ci/ensure-ndk.sh" >/dev/null

download() {
  local url="$1" sha="$2" name="$3"
  echo "$sha  $WORK/$name" > "$WORK/$name.sha"
  curl -fL --retry 5 --retry-all-errors -o "$WORK/$name" "$url"
  sha256sum -c "$WORK/$name.sha"
}

download \
  https://packages.termux.dev/apt/termux-main/pool/main/liba/libandroid-shmem/libandroid-shmem_0.7_aarch64.deb \
  0da3a24d558b93c92bcf8d611e0826a99ff96e396b148e6cdf33b47c47c57ff6 \
  libandroid-shmem.deb
download \
  https://packages.termux.dev/apt/termux-main/pool/main/libt/libtalloc/libtalloc_2.5.0_aarch64.deb \
  556591f43bb773ad8777e1a29522640866a55f95dab71914418b94a8c58ad5a7 \
  libtalloc.deb
download \
  https://packages.termux.dev/apt/termux-main/pool/main/p/proot/proot_5.1.107.101_aarch64.deb \
  a28355e9be257e1f87f4e9294b3118470d4fd7a5442fed8b278f4443c83407d7 \
  proot.deb

extract_one() {
  local deb="$1" pattern="$2" out="$3"
  local dir="$WORK/x-$(basename "$deb" .deb)"
  rm -rf "$dir"
  dpkg-deb -x "$deb" "$dir"
  local found
  found="$(find "$dir" \( -type f -o -type l \) -name "$pattern" -print -quit)"
  if [[ -z "$found" ]]; then
    echo "missing $pattern in $deb" >&2
    find "$dir" -maxdepth 6 -type d >&2
    exit 1
  fi
  cp -L "$found" "$out"
  chmod 755 "$out"
}

extract_one "$WORK/libandroid-shmem.deb" libandroid-shmem.so "$DEST/libandroid-shmem.so"
extract_one "$WORK/libtalloc.deb" 'libtalloc.so.2*' "$DEST/libtalloc.so.2"
extract_one "$WORK/proot.deb" loader "$DEST/loader"
extract_one "$WORK/proot.deb" proot "$DEST/proot"

expect_sha() {
  local file="$1" sha="$2"
  echo "$sha  $file" | sha256sum -c -
}
expect_sha "$DEST/libandroid-shmem.so" 84475798e07c8174dbbfaec70a827fdb02f19ffa69a589380c13e7507fd0e731
expect_sha "$DEST/libtalloc.so.2" 742b438c4d09e276985a61d44164c9de207b6d8cc268f3018cb3001961bcb309
expect_sha "$DEST/loader" 1da54355333cca3fb6ee10e3b82a24df24fb230c99241ce83809bf9e240609b5
echo "proot from the current Termux deb (not the on-device-tested build):"
sha256sum "$DEST/proot"
stat -c 'proot size=%s' "$DEST/proot"

CLANG="$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android26-clang"
"$CLANG" -fPIE -pie -O2 -o "$DEST/omb-guest-chromium" \
  "$ROOT/android/full/runtime/android-arm64/linux/omb-guest-chromium.c"
file "$DEST/omb-guest-chromium" | grep -q 'ARM aarch64'
echo "linux bins staged in $DEST"
