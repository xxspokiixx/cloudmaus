# Android releases

This repository does not contain the historical phone companion (`android/core`
and `android/app` from the upstream notes). The APK this repo builds is
`android/`: an About screen with **Check for update**. It is the installable
package for `xxspokiixx/cloudmaus`.

The desktop app and the self-hosted server do not use this checker. Settings
and the sidebar still call the existing Electron updater (`electron/updater.mjs`,
`electron/updater-coordinator.mjs`). The server lookup in `server/update-check.ts`
is unchanged and still describes how a Docker, npm, or git install is updated.
Neither path downloads an APK.

## Version

`package.json` `"version"` is the single version string (`X.Y.Z`).

- A release tag must be `v` plus that string, for example `v0.1.130`.
- `scripts/android-version.mjs` refuses a tag that does not match `package.json`.
- The APK `versionName` is that string. Gradle also refuses a `-PversionName`
  or `-PversionCode` that disagrees with it.
- `versionCode` is `major * 1_000_000 + minor * 1_000 + patch`. Each component
  must fit: major &lt; 2100, minor &lt; 1000, patch &lt; 1000. `0.1.130` is version
  code `1130`. The installed app reads `versionName` back from the package
  manager, which is the value baked in at build time.

The in-app checker compares that `versionName` with the tag on the latest
stable GitHub Release.

## Check for update

The About screen calls the unauthenticated GitHub API:

`https://api.github.com/repos/xxspokiixx/cloudmaus/releases/latest`

The owner and repository are one constant, `UPDATE_REPOSITORY`, in
`scripts/apk-update.mjs` and `android/core/.../ApkUpdate.kt`. The app sends no
token and no `Authorization` header.

`/releases/latest` is GitHub's latest non-draft, non-prerelease release. The
app still rejects a body marked draft or prerelease, and it rejects a tag that
is not `vX.Y.Z`. If the tag is newer, a dialog shows the version and the
release notes and waits for **Install** or **Not now**. Nothing downloads
before Install.

On Install the app downloads the `.apk` asset and the `<apk name>.sha256`
asset in the background, shows progress, and checks the byte size against the
asset size and the SHA-256 against the checksum file. The checksum file is the
`sha256sum` line published by the workflow (`hex` and the file name). A
mismatch deletes the download and does not open the installer.

The release APK is preferred when both a release-signed and a debug-signed
asset are present. A release that only has `app-debug.apk` can still be
installed, and the dialog says that a debug-signed file cannot replace a
release-signed install.

Android does not allow a normal app to install an update silently. After the
file is verified, the app hands it to the system package installer through a
`FileProvider` content URI. The system shows its own confirmation. The app
needs **Install unknown apps** (`REQUEST_INSTALL_PACKAGES`). If that is off,
the app explains why and opens the system setting for this package. It does
not start the download until the permission is allowed. Cancel, offline,
HTTP 404, GitHub rate limit (HTTP 429, or HTTP 403 when the rate-limit quota
is spent), a missing APK, a missing checksum, and a checksum or size mismatch
are shown on the About screen and do not install anything.

The update APK must be signed with the same key as the install it replaces.
Android rejects a different signature. A debug-signed APK will not upgrade a
release-signed install, and a release-signed APK will not upgrade a
debug-signed install.

## Cut a release

From a commit whose `package.json` version is the version you want:

```sh
git tag vX.Y.Z
git push origin vX.Y.Z
```

`vX.Y.Z` must match `package.json`. Pushing the tag runs **Android APK**. The
build job only has `contents: read`. The release job has `contents: write`,
creates a published (not draft) GitHub Release with generated notes, and
attaches the APK and `OpenMausBot.apk.sha256` (or `app-debug.apk` and
`app-debug.apk.sha256` when the signing secrets are absent).

**Actions → Android APK → Run workflow** with the tag left empty uploads the
APK as a workflow artifact and does not create a Release. Filling in `vX.Y.Z`
checks out that tag, builds it, and publishes the Release. The workflow will
not replace a Release that already exists.

## Signing secrets

Create a keystore once and keep it. Every update of an existing install has
to use this same keystore. Losing it means those installs cannot be upgraded
in place.

```sh
keytool -genkeypair -v -keystore release.keystore -alias cloudmaus \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 release.keystore
```

In **Settings → Secrets and variables → Actions**, add:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | The base64 output above. One line. |
| `ANDROID_KEYSTORE_PASSWORD` | The keystore password. |
| `ANDROID_KEY_ALIAS` | The alias, `cloudmaus` in the command above. |
| `ANDROID_KEY_PASSWORD` | The key password. |

Do not commit the keystore. `*.jks`, `*.keystore`, and `*.p12` are gitignored.

If any of the four secrets is missing, the workflow still builds. The artifact
is `app-debug.apk`, signed with the ephemeral debug keystore, and the run logs
a notice. That file installs on a device that has no copy of the app, or over
another debug build signed with a different debug key only when the signatures
happen to match (they will not, across machines). It will not upgrade an
install that was signed with the release keystore.

## What a device has to confirm

A green workflow proves the APK is signed, the version name and version code
match the tag, and the checksum file matches the APK bytes. It does not prove
the system install confirmation, the Install unknown apps setting, or an
upgrade over an existing install. Those need a phone.
