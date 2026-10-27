import { createHash } from "node:crypto";

// Version comparison and GitHub Release parsing for the Android APK updater.
// The phone runs the Kotlin copy in android/core. Keep the two in step:
// scripts/apk-update.test.ts and the core unit tests cover the same cases.
// Unauthenticated GitHub API only. This module never reads a token.

export const UPDATE_REPOSITORY = "xxspokiixx/cloudmaus";
export const LATEST_RELEASE_URL = `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`;

const STABLE = /^(\d+)\.(\d+)\.(\d+)$/;
const TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
const SHA256 = /\b([0-9a-fA-F]{64})\b/;
const APK_NAME = /^[A-Za-z0-9._-]{1,80}\.apk$/;

/** Android versionCode. major < 2100, minor < 1000, patch < 1000. */
export function versionCode(versionName) {
  const parts = parseStable(versionName);
  if (!parts) throw new Error(`version must be X.Y.Z, got ${versionName}`);
  const [major, minor, patch] = parts;
  if (major >= 2100 || minor >= 1000 || patch >= 1000) {
    throw new Error(`version ${versionName} does not fit Android versionCode`);
  }
  const code = major * 1_000_000 + minor * 1_000 + patch;
  if (code <= 0 || code > 2_100_000_000) throw new Error(`versionCode ${code} is out of range`);
  return code;
}

export function versionNameFromTag(tag) {
  const match = TAG.exec(String(tag).trim());
  if (!match) throw new Error(`release tag must be vX.Y.Z, got ${tag}`);
  return `${match[1]}.${match[2]}.${match[3]}`;
}

function parseStable(value) {
  const match = STABLE.exec(String(value ?? "").trim().replace(/^v/, ""));
  if (!match) return null;
  return match.slice(1).map(Number);
}

/** True when latest is a newer stable X.Y.Z than current. Anything else is not an update. */
export function isNewerVersion(latest, current) {
  const a = parseStable(latest);
  const b = parseStable(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

export function parseChecksum(text) {
  const match = SHA256.exec(String(text ?? ""));
  return match ? match[1].toLowerCase() : null;
}

export function apkFileName(name) {
  return APK_NAME.test(name) && !name.includes("..") ? name : null;
}

/**
 * @param {number} status
 * @param {string} body
 * @param {string | null | undefined} rateLimitRemaining
 * @returns {"rate-limit" | "no-release" | "http" | null}
 */
export function classifyStatus(status, body, rateLimitRemaining) {
  if (status === 200) return null;
  if (status === 404) return "no-release";
  const text = String(body ?? "");
  const limited = String(rateLimitRemaining ?? "").trim() === "0"
    || /rate limit/i.test(text);
  if (status === 429 || (status === 403 && limited)) return "rate-limit";
  return "http";
}

function asset(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.name !== "string" || typeof raw.browser_download_url !== "string") return null;
  if (!Number.isSafeInteger(raw.size) || raw.size < 0) return null;
  if (!raw.browser_download_url.startsWith("https://")) return null;
  return { name: raw.name, size: raw.size, url: raw.browser_download_url };
}

/** @param {string} json */
export function parseRelease(json) {
  let value;
  try {
    value = JSON.parse(json);
  } catch {
    return { ok: false, failure: "bad-release" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, failure: "bad-release" };
  if (typeof value.tag_name !== "string" || typeof value.draft !== "boolean" || typeof value.prerelease !== "boolean") {
    return { ok: false, failure: "bad-release" };
  }
  if (!Array.isArray(value.assets)) return { ok: false, failure: "bad-release" };
  const notes = value.body == null ? "" : value.body;
  if (typeof notes !== "string") return { ok: false, failure: "bad-release" };
  const assets = [];
  for (const raw of value.assets) {
    const parsed = asset(raw);
    if (!parsed) return { ok: false, failure: "bad-release" };
    assets.push(parsed);
  }
  let version = null;
  if (!value.draft && !value.prerelease) {
    try {
      version = versionNameFromTag(value.tag_name);
    } catch {
      return { ok: false, failure: "bad-tag" };
    }
  }
  return {
    ok: true,
    release: {
      tag: value.tag_name,
      version,
      notes,
      draft: value.draft,
      prerelease: value.prerelease,
      assets,
    },
  };
}

function chooseApk(assets) {
  const apks = assets.filter((item) => apkFileName(item.name));
  if (apks.length === 0) return { failure: "no-apk" };
  const signed = apks.filter((item) => !/debug/i.test(item.name));
  const chosen = signed.length === 1 ? signed[0] : signed.length === 0 && apks.length === 1 ? apks[0] : null;
  if (!chosen) return { failure: "ambiguous-apk" };
  if (chosen.size <= 0) return { failure: "no-apk" };
  const checksum = assets.find((item) => item.name === `${chosen.name}.sha256`);
  if (!checksum || checksum.size <= 0) return { failure: "no-checksum" };
  return {
    apk: chosen,
    checksum,
    debugSigned: /debug/i.test(chosen.name),
  };
}

/** @param {ReturnType<typeof parseRelease>} parsed @param {string} installed */
export function decideUpdate(parsed, installed) {
  if (!parsed.ok) return { kind: "failed", failure: parsed.failure };
  const release = parsed.release;
  if (release.draft || release.prerelease) return { kind: "failed", failure: "not-stable" };
  if (!release.version) return { kind: "failed", failure: "bad-tag" };
  if (!parseStable(installed)) return { kind: "failed", failure: "bad-installed" };
  if (!isNewerVersion(release.version, installed)) return { kind: "up-to-date", version: installed };
  const choice = chooseApk(release.assets);
  if (choice.failure) return { kind: "failed", failure: choice.failure };
  return {
    kind: "available",
    tag: release.tag,
    version: release.version,
    notes: release.notes,
    apkName: choice.apk.name,
    apkUrl: choice.apk.url,
    apkSize: choice.apk.size,
    checksumUrl: choice.checksum.url,
    checksumSize: choice.checksum.size,
    debugSigned: choice.debugSigned,
  };
}

/**
 * @param {number} status
 * @param {string} body
 * @param {string | null | undefined} rateLimitRemaining
 * @param {string} installed
 */
export function interpretRelease(status, body, rateLimitRemaining, installed) {
  const failure = classifyStatus(status, body, rateLimitRemaining);
  if (failure) return { kind: "failed", failure, httpStatus: status };
  return decideUpdate(parseRelease(body), installed);
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** @param {Buffer | Uint8Array} bytes @param {number} expectedSize @param {string} checksumText */
export function verifyDownload(bytes, expectedSize, checksumText) {
  if (bytes.byteLength !== expectedSize) {
    return { ok: false, reason: "size", actualSize: bytes.byteLength, expectedSize };
  }
  const expected = parseChecksum(checksumText);
  if (!expected) return { ok: false, reason: "checksum-unreadable" };
  const actual = sha256Hex(bytes);
  if (actual !== expected) return { ok: false, reason: "checksum", actual, expected };
  return { ok: true };
}
