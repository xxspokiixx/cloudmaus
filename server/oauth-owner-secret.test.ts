import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { oauthSecretEnvName, ownerOAuthSecret, ownerOAuthSecretsFile } from "./oauth-owner-secret.ts";

const googleId = "990275019107-584m2ummrr63q5audsv7iqbqv7krnofp.apps.googleusercontent.com";

describe("owner OAuth secret", () => {
  it("names the environment variable from the catalog id", () => {
    expect(oauthSecretEnvName("gmail")).toBe("OPENMAUSBOT_OAUTH_SECRET_GMAIL");
    expect(oauthSecretEnvName("google-calendar")).toBe("OPENMAUSBOT_OAUTH_SECRET_GOOGLE_CALENDAR");
  });

  it("prefers the catalog id, then the google vendor variable, and ignores a secret for another client", () => {
    const file = join(mkdtempSync(join(tmpdir(), "oauth-secret-")), "mcp-oauth.json");
    const env = {
      OPENMAUSBOT_OAUTH_SECRET_GMAIL: "name-secret",
      OPENMAUSBOT_OAUTH_SECRET_GOOGLE: "vendor-secret",
    };
    expect(ownerOAuthSecret(file, "gmail", googleId, env)).toBe("name-secret");
    expect(ownerOAuthSecret(file, "google-calendar", googleId, { OPENMAUSBOT_OAUTH_SECRET_GOOGLE: "vendor-secret" })).toBe("vendor-secret");
    expect(ownerOAuthSecret(file, "slack", "slack-app", { OPENMAUSBOT_OAUTH_SECRET_GOOGLE: "vendor-secret" })).toBeUndefined();
  });

  it("reads the private file beside mcp-oauth.json and skips a secret that is not one line", () => {
    const dir = mkdtempSync(join(tmpdir(), "oauth-secret-"));
    const file = join(dir, "mcp-oauth.json");
    writeFileSync(ownerOAuthSecretsFile(file), JSON.stringify({
      byName: { gmail: "file-secret", google: "shared-secret", slack: "line\nbreak" },
    }));
    expect(ownerOAuthSecretsFile(file)).toBe(join(dir, "mcp-oauth-secrets.json"));
    expect(ownerOAuthSecret(file, "gmail", googleId, {})).toBe("file-secret");
    expect(ownerOAuthSecret(file, "google-docs", googleId, {})).toBe("shared-secret");
    expect(ownerOAuthSecret(file, "slack", "slack-app", {})).toBeUndefined();
    expect(ownerOAuthSecret(file, "gmail", googleId, { OPENMAUSBOT_OAUTH_SECRET_GMAIL: "env-wins" })).toBe("env-wins");
  });
});
