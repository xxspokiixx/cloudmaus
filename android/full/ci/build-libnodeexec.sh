#!/usr/bin/env bash
# Cross-builds Node v24.20.0 for Android arm64 (API 26, 16 KB pages).
# Recipe: android/full/runtime/android-arm64/BUILD-NOTES.md
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
EVIDENCE="$ROOT/android/full/runtime/android-arm64/build-evidence"
OUT="$ROOT/android/full/runtime/android-arm64/libnodeexec.so"
NDK="${NDK_ROOT:-$HOME/android-ndk-r30}"
WORK="${RUNNER_TEMP:-/tmp}/nodebuild"
LOG="${LIBNODE_LOG:-/tmp/libnodeexec-build.log}"
mkdir -p "$(dirname "$OUT")" "$WORK"
exec > >(tee -a "$LOG") 2>&1
echo "=== libnodeexec build $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
bash "$ROOT/android/full/ci/ensure-ndk.sh" >/dev/null
sudo apt-get update
sudo apt-get install -y build-essential python3 ca-certificates xz-utils patch
SRC="$WORK/node-v24.20.0"
if [[ ! -d "$SRC" ]]; then
  echo "downloading node-v24.20.0"
  curl -fL --retry 5 --retry-all-errors -o "$WORK/node-v24.20.0.tar.xz" \
    https://nodejs.org/dist/v24.20.0/node-v24.20.0.tar.xz
  tar -xJf "$WORK/node-v24.20.0.tar.xz" -C "$WORK"
fi
cp "$NDK/sources/android/cpufeatures/cpu-features.c" "$SRC/deps/zlib/cpu-features.c"
cp "$NDK/sources/android/cpufeatures/cpu-features.h" "$SRC/deps/zlib/cpu-features.h"
patch -d "$SRC" -p0 --forward --batch < "$EVIDENCE/zlib-android-cpu-features.diff"
patch -d "$SRC" -p0 --forward --batch < "$EVIDENCE/v8-android-traphandler-sim.diff"
grep -q 'cpu-features.c' "$SRC/deps/zlib/zlib.gyp"
grep -q 'openharmony android' "$SRC/tools/v8_gypfiles/v8.gyp"
export CC_host=/usr/bin/gcc
export CXX_host=/usr/bin/g++
export LDFLAGS='-Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384 -static-libstdc++'
cd "$SRC"
chmod +x ./android-configure
./android-configure "$NDK" 26 arm64
make -C out BUILDTYPE=Release -j8 node
install -m 644 out/Release/node "$OUT"
echo "=== result ==="
file "$OUT"
stat -c 'size=%s' "$OUT"
sha256sum "$OUT"
file "$OUT" | grep -q 'ARM aarch64'
echo "libnodeexec build ok"
