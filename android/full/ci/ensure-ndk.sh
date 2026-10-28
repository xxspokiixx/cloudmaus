#!/usr/bin/env bash
# Unzips Android NDK r30 (Pkg.Revision 30.0.16248370) to $HOME/android-ndk-r30.
set -euo pipefail
NDK="${NDK_ROOT:-$HOME/android-ndk-r30}"
ZIP="${NDK_ZIP:-$HOME/android-ndk-r30-linux.zip}"
CLANG="$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android26-clang"
if [[ -x "$CLANG" ]]; then
  echo "NDK already present at $NDK"
  echo "$NDK"
  exit 0
fi
if [[ ! -f "$ZIP" ]]; then
  echo "downloading NDK r30"
  curl -fL --retry 5 --retry-all-errors -o "$ZIP.partial" \
    https://dl.google.com/android/repository/android-ndk-r30-linux.zip
  mv "$ZIP.partial" "$ZIP"
fi
rm -rf "$NDK"
unzip -q "$ZIP" -d "$HOME"
if [[ ! -x "$CLANG" ]]; then
  echo "NDK clang missing after unzip: $CLANG" >&2
  exit 1
fi
echo "$NDK"
