import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { catalogOAuthBody, catalogServerName, parsePluginCatalog, pluginActions, sameMcpUrl } from "../shared/plugin-catalog.ts";
import { mcpOAuthRedirectUri } from "./mcp-oauth.ts";

const raw = JSON.parse(readFileSync(new URL("../shared/plugin-catalog.json", import.meta.url), "utf8")) as unknown;
const doc = readFileSync(new URL("../docs/app-registration.md", import.meta.url), "utf8");

describe("plugin catalog", () => {
  const entries = parsePluginCatalog(raw);
  if (!Array.isArray(entries)) throw new Error(entries.error);

  it("stores only the Microsoft public client id and never a secret", () => {
    const text = JSON.stringify(raw);
    const microsoft = ["onedrive", "outlook", "outlook-calendar", "sharepoint", "teams"];
    const clientId = "6bfa5a3d-30cd-4945-acff-4a925d2e9aa7";
    const withClientId = entries.flatMap((entry) => entry.mcp?.clientId ? [[entry.id, entry.mcp.clientId] as const] : []);
    expect(withClientId).toEqual(microsoft.map((id) => [id, clientId]));
    expect(text.match(/"clientId"/g)).toHaveLength(5);
    expect(text).not.toContain("clientSecret");
    expect(text).not.toContain("NGdZYmo4");
    expect(text).not.toContain("1601185624273.8899143856786");
    expect(text).not.toContain("1854843612533787");
    expect(text).toContain("fdcc1f02-fc51-4226-8753-f668596af7f7/WorkIQAgent.Ask");
    const en = JSON.parse(readFileSync(new URL("../src/locales/en.json", import.meta.url), "utf8")) as {
      "plugins.register": string;
      "connectors.action.connect": string;
    };
    expect(en["plugins.register"]).toBe("Needs app registration");
    expect(en["connectors.action.connect"]).toBe("Connect");
    for (const id of microsoft) {
      const entry = entries.find((item) => item.id === id)!;
      const kinds = pluginActions(entry).map((action) => action.kind);
      expect(kinds, id).toContain("connect");
      expect(kinds, id).not.toContain("register");
      expect(catalogOAuthBody(entry.mcp!)).toEqual({
        clientId,
        scopes: ["fdcc1f02-fc51-4226-8753-f668596af7f7/WorkIQAgent.Ask"],
      });
    }
  });

  it("connects only verified OAuth, and asks the owner to register when dynamic registration is missing", () => {
    const connect = entries.filter((entry) => pluginActions(entry).some((action) => action.kind === "connect")).map((entry) => entry.id);
    const register = entries.filter((entry) => pluginActions(entry).some((action) => action.kind === "register")).map((entry) => entry.id);
    const token = entries.filter((entry) => pluginActions(entry).some((action) => action.kind === "token")).map((entry) => entry.id);
    expect(connect).toEqual([
      "apify", "asana", "atlassian", "canva", "cloudflare", "etoro-trading", "exa", "figma", "linear", "notion",
      "onedrive", "outlook", "outlook-calendar", "sentry", "sharepoint", "stripe", "tavily", "teams", "vercel", "whop",
    ]);
    expect(register).toEqual([
      "github", "gmail", "google-calendar", "google-docs", "google-drive", "google-sheets", "google-slides", "hubspot",
      "slack", "x", "zoom",
    ]);
    expect(token).toEqual([]);
    for (const entry of entries) {
      const manual = pluginActions(entry).some((action) => action.kind === "manual");
      if (entry.mcp && !entry.mcp.verified) expect(manual, entry.id).toBe(true);
      if (!entry.mcp && entry.kind !== "skills") expect(manual, entry.id).toBe(true);
    }
  });

  it("documents the loopback redirect URI and scopes the owner must register", () => {
    const microsoft = ["onedrive", "outlook", "outlook-calendar", "sharepoint", "teams"];
    for (const entry of entries) {
      const action = pluginActions(entry).find((item) => item.kind === "register");
      if (!action || action.kind !== "register" || !entry.mcp) continue;
      const uri = mcpOAuthRedirectUri(entry.mcp.url);
      expect(doc, entry.id).toContain(uri);
      expect(doc, entry.id).toContain(`\`${entry.id}\``);
      expect(doc, entry.id).toContain(action.docsUrl);
      for (const scope of entry.mcp.scopes) expect(doc, `${entry.id} ${scope}`).toContain(scope);
    }
    const workIq = mcpOAuthRedirectUri("https://workiq.svc.cloud.microsoft/mcp");
    expect(new Set(microsoft.map((id) => entries.find((entry) => entry.id === id)?.mcp?.url))).toEqual(new Set(["https://workiq.svc.cloud.microsoft/mcp"]));
    expect(doc).toContain(workIq);
    expect(doc).toContain("organizations");
    expect(doc).toContain("6bfa5a3d-30cd-4945-acff-4a925d2e9aa7");
    expect(doc).toContain("Web application");
    expect(doc).toContain("https://developers.google.com/workspace/guides/configure-mcp-servers");
    expect(catalogOAuthBody(entries.find((entry) => entry.id === "gmail")!.mcp!)).toBeUndefined();
  });

  it("reuses one saved server for every card that shares a URL", () => {
    expect(sameMcpUrl("https://workiq.svc.cloud.microsoft/mcp", "https://workiq.svc.cloud.microsoft/mcp/")).toBe(true);
    const servers = [{ name: "outlook", url: "https://workiq.svc.cloud.microsoft/mcp" }];
    expect(catalogServerName("teams", "https://workiq.svc.cloud.microsoft/mcp/", servers)).toBe("outlook");
    expect(catalogServerName("slack", "https://mcp.slack.com/mcp", servers)).toBe("slack");
    expect(catalogServerName("slack", "https://mcp.slack.com/mcp", [...servers, { name: "slack", url: "https://example.com" }])).toBe("slack-2");
  });
});
