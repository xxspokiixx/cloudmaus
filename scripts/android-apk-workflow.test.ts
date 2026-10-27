import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const workflow = parse(readFileSync(new URL("../.github/workflows/android-apk.yml", import.meta.url), "utf8"));
const text = readFileSync(new URL("../.github/workflows/android-apk.yml", import.meta.url), "utf8");

describe("Android APK workflow", () => {
  it("publishes a release only for a v* tag, and writes contents only on that job", () => {
    expect(workflow.on.push.tags).toEqual(["v*"]);
    expect(workflow.on.workflow_dispatch.inputs.tag).toBeTruthy();
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.build.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.release.permissions).toEqual({ contents: "write" });
    expect(workflow.jobs.release.needs).toBe("build");
    expect(workflow.jobs.release.if).toBe("startsWith(github.ref, 'refs/tags/v') || (github.event_name == 'workflow_dispatch' && inputs.tag != '')");
    expect(text).toContain("gh release create");
    expect(text).not.toContain("--draft");
  });

  it("signs with the stable keystore secrets or falls back to app-debug.apk, and publishes a checksum", () => {
    for (const name of ["ANDROID_KEYSTORE_BASE64", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"]) {
      expect(text).toContain(name);
    }
    expect(text).toContain("name=OpenMausBot.apk");
    expect(text).toContain("name=app-debug.apk");
    expect(text).toContain("sha256sum");
    expect(text).toContain(".sha256");
    expect(text).toContain("java-version: 17");
    // ubuntu-latest sets ANDROID_SDK_ROOT to its preinstalled SDK. AGP aborts
    // when that path differs from ANDROID_HOME, so the workflow installs into
    // one SDK and points both variables at it.
    expect(text).toContain('sdkmanager --sdk_root="$sdk"');
    expect(text).toContain('echo "ANDROID_HOME=$sdk" >> "$GITHUB_ENV"');
    expect(text).toContain('echo "ANDROID_SDK_ROOT=$sdk" >> "$GITHUB_ENV"');
    expect(text).toContain("./gradlew :core:test");
    expect(text).toContain(":app:assembleRelease");
    expect(text).toContain(":app:assembleDebug");
    expect(text).toContain("node scripts/android-version.mjs --tag");
    expect(text).not.toMatch(/-----BEGIN |ghp_|github_pat_/);
  });

  it("asks for the system installer and tells the user it is not silent", () => {
    const manifest = readFileSync(new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
    const strings = readFileSync(new URL("../android/app/src/main/res/values/strings.xml", import.meta.url), "utf8");
    const activity = readFileSync(new URL("../android/app/src/main/kotlin/com/openmausbot/companion/MainActivity.kt", import.meta.url), "utf8");
    expect(manifest).toContain("android.permission.REQUEST_INSTALL_PACKAGES");
    expect(manifest).toContain("androidx.core.content.FileProvider");
    expect(strings).toContain("Check for update");
    expect(strings).toContain("cannot install an update silently");
    expect(strings).toContain("Install unknown apps");
    expect(activity).toContain("canRequestPackageInstalls");
    expect(activity).toContain("ACTION_MANAGE_UNKNOWN_APP_SOURCES");
    expect(activity).not.toMatch(/Authorization|ghp_|github_pat_/);
  });

  it("pins every external action to a full commit SHA", () => {
    const uses = (Object.values(workflow.jobs) as { steps?: { uses?: string }[] }[])
      .flatMap((job) => job.steps ?? [])
      .flatMap((step) => (step.uses ? [step.uses] : []));
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) expect(action).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
  });
});
