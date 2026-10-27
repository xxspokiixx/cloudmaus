import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  apkFileName,
  classifyStatus,
  decideUpdate,
  interpretRelease,
  isNewerVersion,
  LATEST_RELEASE_URL,
  parseChecksum,
  parseRelease,
  sha256Hex,
  UPDATE_REPOSITORY,
  verifyDownload,
  versionCode,
  versionNameFromTag,
} from "./apk-update.mjs";

const apk = (name: string, size = 12) => ({
  name,
  size,
  browser_download_url: `https://github.com/xxspokiixx/cloudmaus/releases/download/v1.2.3/${name}`,
});

function release(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    tag_name: "v1.2.3",
    body: "Fixes the pairing screen.\n",
    draft: false,
    prerelease: false,
    assets: [apk("OpenMausBot.apk", 20), apk("OpenMausBot.apk.sha256", 71)],
    ...overrides,
  });
}

describe("apk version", () => {
  it("derives Android versionCode from X.Y.Z", () => {
    expect(versionCode("0.1.129")).toBe(1129);
    expect(versionCode("1.2.3")).toBe(1_002_003);
    expect(versionCode("0.0.1")).toBe(1);
    expect(versionCode("2099.999.999")).toBe(2_099_999_999);
    expect(() => versionCode("2100.0.0")).toThrow(/versionCode/);
    expect(() => versionCode("0.1000.0")).toThrow(/versionCode/);
    expect(() => versionCode("1.2.3-rc.1")).toThrow(/X\.Y\.Z/);
    expect(versionNameFromTag("v0.1.129")).toBe("0.1.129");
    expect(() => versionNameFromTag("0.1.129")).toThrow(/vX\.Y\.Z/);
    expect(() => versionNameFromTag("v0.1.129-rc.1")).toThrow(/vX\.Y\.Z/);
  });

  it("uses the same formula in the Android sources", () => {
    const formula = "major * 1_000_000 + minor * 1_000 + patch";
    for (const file of [
      "android/core/src/main/kotlin/com/openmausbot/companion/update/ApkUpdate.kt",
      "android/app/build.gradle.kts",
    ]) {
      expect(readFileSync(new URL(`../${file}`, import.meta.url), "utf8")).toContain(formula);
    }
  });

  it("compares stable versions and ignores anything else", () => {
    expect(isNewerVersion("v1.2.3", "1.2.2")).toBe(true);
    expect(isNewerVersion("1.2.0", "1.1.9")).toBe(true);
    expect(isNewerVersion("2.0.0", "1.9.9")).toBe(true);
    expect(isNewerVersion("1.2.3", "1.2.3")).toBe(false);
    expect(isNewerVersion("1.2.2", "1.2.3")).toBe(false);
    expect(isNewerVersion("1.2.3-rc.1", "1.2.2")).toBe(false);
    expect(isNewerVersion("nightly", "1.2.2")).toBe(false);
    expect(isNewerVersion("v1.2.3", "")).toBe(false);
  });
});

describe("apk release parsing", () => {
  it("points at this repository and no other", () => {
    expect(UPDATE_REPOSITORY).toBe("xxspokiixx/cloudmaus");
    expect(LATEST_RELEASE_URL).toBe("https://api.github.com/repos/xxspokiixx/cloudmaus/releases/latest");
    const kotlin = readFileSync(new URL("../android/core/src/main/kotlin/com/openmausbot/companion/update/ApkUpdate.kt", import.meta.url), "utf8");
    expect(kotlin).toContain('const val UPDATE_REPOSITORY = "xxspokiixx/cloudmaus"');
    expect(kotlin).not.toMatch(/Authorization|ghp_|github_pat_/);
  });

  it("selects a newer release APK and its checksum asset", () => {
    const decision = decideUpdate(parseRelease(release()), "1.2.2");
    expect(decision).toMatchObject({
      kind: "available",
      tag: "v1.2.3",
      version: "1.2.3",
      notes: "Fixes the pairing screen.\n",
      apkName: "OpenMausBot.apk",
      apkSize: 20,
      debugSigned: false,
    });
    expect(decision).toMatchObject({ checksumUrl: expect.stringContaining("OpenMausBot.apk.sha256") });
  });

  it("prefers the release APK when a debug APK is also attached", () => {
    const body = release({
      assets: [apk("app-debug.apk"), apk("app-debug.apk.sha256", 8), apk("OpenMausBot.apk"), apk("OpenMausBot.apk.sha256", 8)],
    });
    expect(decideUpdate(parseRelease(body), "1.2.0")).toMatchObject({ apkName: "OpenMausBot.apk", debugSigned: false });
  });

  it("accepts a lone debug APK and marks it debug-signed", () => {
    const body = release({ assets: [apk("app-debug.apk"), apk("app-debug.apk.sha256", 8)] });
    expect(decideUpdate(parseRelease(body), "1.0.0")).toMatchObject({ apkName: "app-debug.apk", debugSigned: true });
  });

  it("reports up to date, missing assets, and releases that are not stable", () => {
    expect(decideUpdate(parseRelease(release()), "1.2.3")).toEqual({ kind: "up-to-date", version: "1.2.3" });
    expect(decideUpdate(parseRelease(release()), "1.2.4")).toEqual({ kind: "up-to-date", version: "1.2.4" });
    expect(decideUpdate(parseRelease(release({ assets: [] })), "1.0.0")).toMatchObject({ failure: "no-apk" });
    expect(decideUpdate(parseRelease(release({ assets: [apk("OpenMausBot.apk")] })), "1.0.0")).toMatchObject({ failure: "no-checksum" });
    expect(decideUpdate(parseRelease(release({ draft: true })), "1.0.0")).toMatchObject({ failure: "not-stable" });
    expect(decideUpdate(parseRelease(release({ prerelease: true })), "1.0.0")).toMatchObject({ failure: "not-stable" });
    expect(decideUpdate(parseRelease(release({
      assets: [apk("one.apk"), apk("one.apk.sha256", 4), apk("two.apk"), apk("two.apk.sha256", 4)],
    })), "1.0.0")).toMatchObject({ failure: "ambiguous-apk" });
    expect(decideUpdate(parseRelease(release({ tag_name: "nightly" })), "1.0.0")).toMatchObject({ failure: "bad-tag" });
    expect(parseRelease("{")).toEqual({ ok: false, failure: "bad-release" });
    expect(decideUpdate(parseRelease(release()), "beta")).toMatchObject({ failure: "bad-installed" });
  });

  it("rejects asset names that are not a single apk file", () => {
    expect(apkFileName("OpenMausBot.apk")).toBe("OpenMausBot.apk");
    expect(apkFileName("../OpenMausBot.apk")).toBeNull();
    expect(apkFileName("a/b.apk")).toBeNull();
    expect(decideUpdate(parseRelease(release({ assets: [apk("../evil.apk"), apk("../evil.apk.sha256", 4)] })), "1.0.0")).toMatchObject({ failure: "no-apk" });
  });

  it("classifies GitHub HTTP responses", () => {
    expect(classifyStatus(200, "{}", null)).toBeNull();
    expect(classifyStatus(404, "missing", null)).toBe("no-release");
    expect(classifyStatus(403, "API rate limit exceeded", "0")).toBe("rate-limit");
    expect(classifyStatus(429, "slow down", "1")).toBe("rate-limit");
    expect(classifyStatus(403, "Resource not accessible", "50")).toBe("http");
    expect(classifyStatus(500, "nope", null)).toBe("http");
    expect(interpretRelease(404, "", null, "1.0.0")).toMatchObject({ failure: "no-release", httpStatus: 404 });
    expect(interpretRelease(200, release(), "50", "1.0.0")).toMatchObject({ kind: "available", version: "1.2.3" });
  });

  it("checks size and the published SHA-256", () => {
    const bytes = Buffer.from("cloudmaus-apk");
    const hash = sha256Hex(bytes);
    expect(hash).toHaveLength(64);
    expect(parseChecksum(`${hash}  OpenMausBot.apk\n`)).toBe(hash);
    expect(parseChecksum("nope")).toBeNull();
    expect(verifyDownload(bytes, bytes.length, `${hash}  OpenMausBot.apk`)).toEqual({ ok: true });
    expect(verifyDownload(bytes, bytes.length + 1, hash)).toMatchObject({ ok: false, reason: "size" });
    expect(verifyDownload(bytes, bytes.length, `${"a".repeat(64)}`)).toMatchObject({ ok: false, reason: "checksum" });
    expect(verifyDownload(bytes, bytes.length, "zz")).toMatchObject({ ok: false, reason: "checksum-unreadable" });
    expect(sha256Hex(Buffer.from("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("android version command", () => {
  it("prints the package version and refuses a tag that disagrees", () => {
    const packaged = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version as string;
    const fromPackage = spawnSync(process.execPath, ["scripts/android-version.mjs", "--from-package"], { encoding: "utf8" });
    expect(fromPackage.status).toBe(0);
    expect(fromPackage.stdout).toBe(`versionName=${packaged}\nversionCode=${versionCode(packaged)}\n`);
    const mismatch = spawnSync(process.execPath, ["scripts/android-version.mjs", "--tag", "v0.0.1"], { encoding: "utf8" });
    expect(mismatch.status).toBe(1);
    expect(mismatch.stderr).toContain("package.json");
    const match = spawnSync(process.execPath, ["scripts/android-version.mjs", "--tag", `v${packaged}`], { encoding: "utf8" });
    expect(match.status).toBe(0);
    expect(match.stdout).toContain(`versionName=${packaged}`);
  });
});
