// Prints versionName and versionCode for the Android build.
// A release tag must be vX.Y.Z and must equal package.json's version.
import { readFileSync } from "node:fs";

import { versionCode, versionNameFromTag } from "./apk-update.mjs";

function packageVersion() {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  if (typeof pkg.version !== "string" || !/^\d+\.\d+\.\d+$/.test(pkg.version)) {
    throw new Error(`package.json version must be X.Y.Z, got ${pkg.version}`);
  }
  return pkg.version;
}

function emit(name) {
  process.stdout.write(`versionName=${name}\nversionCode=${versionCode(name)}\n`);
}

const [flag, value] = process.argv.slice(2);
if (flag === "--tag") {
  const name = versionNameFromTag(value ?? "");
  const packaged = packageVersion();
  if (name !== packaged) {
    console.error(`release tag ${value} is version ${name}, but package.json is ${packaged}. They must match.`);
    process.exit(1);
  }
  emit(name);
} else if (flag === "--from-package") {
  emit(packageVersion());
} else {
  console.error("usage: android-version.mjs --tag vX.Y.Z | --from-package");
  process.exit(2);
}
