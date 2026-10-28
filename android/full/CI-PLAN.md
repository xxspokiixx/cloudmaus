# android-full PLAN (facts from android-test on WINDOWS-SD21HT7, read 2026-10-27)

## What the app is
Local-only Android "test shell" (package com.openmausbot.localtest, branded SpokyBot): Kotlin WebView app (MainActivity, NodeHostService, DeviceAppsService, NodeState) that spawns a bundled Node 24 binary (jniLibs/arm64-v8a/libnodeexec.so) running the OpenMausBot server (assets/omb/server) + web UI (assets/omb/ui), plus a proot'ed Debian arm64 "local desktop" (bash/python/git/curl/Chromium). arm64 only. targetSdk 28 on purpose (29+ forbids exec from app data) => sideload/test only, not Play-distributable.

## Build toolchain
- Gradle 9.1.0 (wrapper), AGP com.android.application 9.0.0-alpha09 (built-in Kotlin, stdlib 2.2.10; do NOT add org.jetbrains.kotlin.android plugin)
- compileSdk 35, minSdk 26, targetSdk 28; SDK: platforms;android-35, build-tools;35.0.0, platform-tools
- JDK >= 17 (Java/Kotlin target 17; author ran daemon on JDK 27). Use JDK 17 or 21 in CI.
- dep: kotlinx-coroutines-android 1.10.2. jniLibs useLegacyPackaging=true (required).
- NDK only needed to rebuild native bits (r30, 30.0.16248370).
- gradle-wrapper.jar (45 KB binary) NOT committed; CI: use gradle/actions/setup-gradle with gradle-version 9.1.0 or run `gradle wrapper --gradle-version 9.1.0`, then `chmod +x gradlew` (mode not preserved by connector).

## Exact build inputs
1. Repo root (cloudmaus) build outputs consumed by prepare-android-assets.mjs:
   - dist-server/index.js (+ dir) -> assets/omb/server   [`corepack pnpm run build:server`]
   - dist/index.html (+ dir) -> assets/omb/ui            [`corepack pnpm exec vite build`]
   - server/testing/* fake-CLI closure -> assets/omb/engine
   - skills/ (if present) -> assets/omb/skills
   - package.json version -> assets/omb/VERSION
2. android/full/runtime/android-arm64/libnodeexec.so -> app/src/main/jniLibs/arm64-v8a/ (skipped with notice if absent)
3. android/full/runtime/android-arm64/linux/{rootfs.tar.gz->rootfs.blob, proot, loader, libtalloc.so.2, libandroid-shmem.so, omb-guest-chromium} + linux/*.mjs -> assets/omb/linux (whole block skipped if rootfs.tar.gz absent)
Paths patched in the branch: script now uses its own dir for android-side paths and ROOT=../.. (override OMB_REPO_ROOT). Then: `node prepare-android-assets.mjs && ./gradlew :app:assembleDebug` -> app/build/outputs/apk/debug/app-debug.apk. Optional: `node smoke-bundle.mjs` (boots staged server with host node; expects "PASS fixture engine reply within 60 s") — runnable on ubuntu runner.

## Large artifacts
| artifact | size | sha256 | origin | CI |
|---|---|---|---|---|
| libnodeexec.so (Node v24.20.0 android arm64 API26, unstripped) | 123,342,736 | e76f394fd6638827e0876036784568a22cfe64493452e4b2a9978ef9a0d89d03 | nodejs.org/dist node-v24.20.0.tar.xz; ./android-configure $NDK 26 arm64; make -C out BUILDTYPE=Release -j8 node; env CC_host=gcc CXX_host=g++ LDFLAGS='-Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384 -static-libstdc++'; 2 patches (zlib cpu-features, v8.gyp trap-handler 'android'), diffs in build-evidence/ | Rebuildable but heavy: ~1.4-2 h on 4-core runner, OOMed at 7.6 GB RAM (needs swap), ~15-20 GB disk incl NDK 738 MB. Recommend pinned download (private release asset/other store) + sha256; optional cached rebuild workflow. Could `llvm-strip` to cut size. |
| rootfs.tar.gz (Debian bookworm arm64 + chromium python3 git curl fonts, 204 debs, 15,981 entries) | 471,726,075 (notes say 379,887,566 – stale) | 2bab5ebae4c688a9a04a499f4c6f768dca5a49106d4579d183d59598ef182871 | docker.io debian:bookworm arm64 layer + dpkg-deb -x of apt closure, symlink/hardlink rewrites; built by build-debian-rootfs.py that lives in the user's %TEMP%\opencode (NOT in project, NOT copied) | Rebuildable on ubuntu x86 (no emulation needed: only downloads + dpkg-deb -x), ~10 min, ~3 GB disk — but builder script must first be recovered/committed. Otherwise pinned download + sha256. Over GitHub 100 MB file limit; release asset limit 2 GB OK. |
| proot / loader / libtalloc.so.2 / libandroid-shmem.so | 258,576 / 18,136 / 33,592 / 14,432 | 0b9b0448… / 1da54355… / 742b438c… / 84475798… (full in linux/BUILD-NOTES.md) | Termux bionic PIE builds | Pinned download of Termux .debs (packages.termux.dev) + sha256 check; small (<300 KB) |
| omb-guest-chromium | 8,960 | – | omb-guest-chromium.c (committed) compiled with NDK r30 aarch64-linux-android26-clang -fPIE -pie | Rebuild in CI (seconds) with setup-ndk r30 |
| qemu/ (24 files, 16 MB) | | | Termux qemu-user-aarch64 11.1.2 | NOT staged; ignore in CI |
Resulting APK ~537 MB (rootfs 472 + node 123 compressed in APK). Only GitHub Actions artifacts/releases can hold it.

## Device-only limits (CI cannot test)
On-device boot/pairing/WebView, proot exec (needs targetSdk 28 domain), Chromium in guest, DNS rewrite, DeviceAppsService (accessibility), notifications, file chooser; verified only on Samsung SM-P610 Android 16. README limits: no mic bridge, no downloads/app-links, native goBack only, child processes may outlive destroy.

## Rootfs personal-data check (tar -tzf listing, 15,981 entries)
/root has only .bashrc, .profile; /home empty; no .env, .ssh, id_rsa, *.key, browser profiles, cookies, Login Data. Matches for "token/credential/cookie" are stock package files (perl, python, git docs). Only PEM is /usr/lib/ssl/cert.pem (CA bundle). Contents = Debian packages (DFSG/GPL etc.; Chromium BSD + bundled codecs) — redistributable with license notices; GPL source-offer obligation applies if published.

## Risks
1. AGP 9.0.0-alpha09 is alpha; may vanish/require newer Gradle — pin or move to stable AGP 9.x.
2. rootfs builder script not in repo -> rootfs not reproducible from source.
3. APK ~537 MB: artifact upload slow; Gradle aapt with 2 GB heap may need -Xmx4g; runner disk (~14 GB free) OK.
4. Binaries >100 MB cannot go in git; need external pinned storage.
5. Debian bookworm apt snapshot drift if rebuilt (pin snapshot.debian.org timestamp).
6. targetSdk 28: Play would reject; fine for sideload.
7. gradlew exec bit + missing wrapper jar on branch.
8. prepare script paths changed from android-test/ to android/full/ (untested on device layout; staged asset layout unchanged).
9. No signing config: debug keystore auto-generated per runner => APK signature changes each CI run (reinstall needs uninstall). Use a stable debug keystore from secrets.

## Termux pinned downloads (verified 2026-10-27, HTTP 200 from box; extracted file hashes compared)
| file | deb URL | deb sha256 | match committed hash? |
|---|---|---|---|
| libandroid-shmem.so | https://packages.termux.dev/apt/termux-main/pool/main/liba/libandroid-shmem/libandroid-shmem_0.7_aarch64.deb | 0da3a24d558b93c92bcf8d611e0826a99ff96e396b148e6cdf33b47c47c57ff6 | YES (84475798…) usr/lib/libandroid-shmem.so |
| libtalloc.so.2 | https://packages.termux.dev/apt/termux-main/pool/main/libt/libtalloc/libtalloc_2.5.0_aarch64.deb | 556591f43bb773ad8777e1a29522640866a55f95dab71914418b94a8c58ad5a7 | YES (742b438c…) usr/lib/libtalloc.so.2.5.0 |
| loader | https://packages.termux.dev/apt/termux-main/pool/main/p/proot/proot_5.1.107.101_aarch64.deb | a28355e9be257e1f87f4e9294b3118470d4fd7a5442fed8b278f4443c83407d7 | YES (1da54355…) usr/libexec/proot/loader |
| proot | same deb | same | NO: deb has 259,784 B sha256 bc3e5416…fa09; committed is 258,576 B 0b9b0448… (older/other build; Termux pool keeps only current). Either accept current proot (needs device test) or host the original. |
Paths inside debs are under data/data/com.termux/files/usr/.

## Rootfs builder (recovered)
build-debian-rootfs.py (10,836 B) from %TEMP%\opencode, now on branch. Facts: pulls floating docker.io/library/debian:trixie arm64 (docstring/notes wrongly say bookworm; base-files 13.8+deb13u7), no digest pin; anonymous registry token fetched at runtime (no secret); apt with --allow-unauthenticated/AllowInsecureRepositories; adds npm opencode-linux-arm64 1.19.4. Runs unprivileged on x86 Linux (needs apt-get, dpkg-deb, curl). Pin: resolve trixie digest + snapshot.debian.org date. Inventory in debian-packages.txt (base versions only; added-deb versions unrecorded).
