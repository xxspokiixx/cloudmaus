// Optional OAuth client secret for a catalog card. Never read from the catalog, a URL, or config.json.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SECRET = /^[\x20-\x7e]{1,4096}$/;

/** `OPENMAUSBOT_OAUTH_SECRET_GMAIL` for `gmail`, `OPENMAUSBOT_OAUTH_SECRET_GOOGLE_CALENDAR` for `google-calendar`. */
export function oauthSecretEnvName(name: string): string {
  return `OPENMAUSBOT_OAUTH_SECRET_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

/** Sibling of mcp-oauth.json, same directory and the same private-file idea. The desktop path is ~/.openmausbot/mcp-oauth-secrets.json. */
export function ownerOAuthSecretsFile(oauthFile: string): string {
  return join(dirname(oauthFile), "mcp-oauth-secrets.json");
}

function usable(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const secret = value.trim();
  return SECRET.test(secret) ? secret : undefined;
}

function googleClient(clientId: string | undefined): boolean {
  return typeof clientId === "string" && clientId.endsWith(".apps.googleusercontent.com");
}

function fromFile(oauthFile: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(ownerOAuthSecretsFile(oauthFile), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const byName = (parsed as { byName?: unknown }).byName;
    return byName && typeof byName === "object" && !Array.isArray(byName) ? byName as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/**
 * Name-specific value wins over the `google` vendor value. An environment variable wins over the file.
 * Returns nothing when no usable secret is set, so sign-in stays a public client with PKCE.
 */
export function ownerOAuthSecret(
  oauthFile: string,
  name: string,
  clientId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const keys = googleClient(clientId) ? [name, "google"] : [name];
  for (const key of keys) {
    const secret = usable(env[oauthSecretEnvName(key)]);
    if (secret) return secret;
  }
  const saved = fromFile(oauthFile);
  for (const key of keys) {
    const secret = usable(saved[key]);
    if (secret) return secret;
  }
  return undefined;
}
