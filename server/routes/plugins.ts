import type { AppConfig } from "../config.ts";
import { MAX_MCP_SERVERS } from "../mcp-registry.ts";
import {
  importManualPlugin, installCatalogSkills, installedPluginIds, parseManualPluginRequest, previewManualPlugin, removeCatalogSkills,
} from "../plugin-pack.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { BusyFlag } from "./config.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface PluginRouteDeps {
  cfg: Pick<AppConfig, "mcpServers">;
  mcpConfigBusy: BusyFlag;
  mcpPolicyRefusal(name: string, server: object): string | undefined;
  persistMcpServers(next: Record<string, unknown>): void;
  fetch?: typeof fetch;
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function folderAllowed(auth: RequestAuth): boolean {
  return auth.kind === "loopback" && auth.trust !== "service";
}

/** Catalog skills and the Add manually preview. MCP servers saved here stay off until tested. */
export function createPluginRoutes(deps: PluginRouteDeps): RouteHandler {
  const fetcher = deps.fetch ?? fetch;
  return async ({ res, path, method, auth, json, readBody, req }) => {
    if (method === "GET" && path === "/api/plugins/skills") {
      return json(res, 200, { ids: installedPluginIds() });
    }

    const remove = method === "DELETE" ? /^\/api\/plugins\/skills\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(path) : null;
    if (remove) {
      if (!ID.test(remove[1]!)) return json(res, 400, { error: "Unknown plugin." });
      return json(res, 200, { removed: removeCatalogSkills(remove[1]!) });
    }

    if (method === "POST" && path === "/api/plugins/skills/install") {
      if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      const body = await readBody(req, 4_096);
      const id = body && typeof body === "object" && typeof (body as { id?: unknown }).id === "string" ? (body as { id: string }).id : "";
      if (!ID.test(id)) return json(res, 400, { error: "Unknown plugin." });
      const result = await installCatalogSkills(id, fetcher);
      return "error" in result ? json(res, 400, result) : json(res, 200, result);
    }

    if (method !== "POST" || (path !== "/api/plugins/preview" && path !== "/api/plugins/import")) return PASS;
    if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      return json(res, 415, { error: "content-type must be application/json" });
    }
    const request = parseManualPluginRequest(await readBody(req, 120_000));
    if ("error" in request) return json(res, 400, request);
    const localFolder = request.kind === "folder"
      || (request.kind === "skills" && (request.source.startsWith("/") || /^[A-Za-z]:[\\/]/.test(request.source)));
    if (localFolder && !folderAllowed(auth)) {
      return json(res, 403, { error: "Only the desktop app on this computer can read a local folder." });
    }
    if (path === "/api/plugins/preview") return json(res, 200, await previewManualPlugin(request, fetcher));

    if (deps.mcpConfigBusy.get()) return json(res, 409, { error: "MCP servers are already being updated." });
    deps.mcpConfigBusy.set(true);
    try {
      const result = await importManualPlugin(request, (servers, current) => {
        const names = Object.keys(servers);
        const taken = names.filter((name) => Object.hasOwn(current, name));
        if (taken.length) return { ok: false, error: `Already added: ${taken.join(", ")}. Remove or rename ${taken.length === 1 ? "it" : "them"} first.` };
        if (Object.keys(current).length + names.length > MAX_MCP_SERVERS) {
          return { ok: false, error: `You can add at most ${MAX_MCP_SERVERS} MCP servers.` };
        }
        const refused = names.filter((name) => deps.mcpPolicyRefusal(name, servers[name] as object));
        if (refused.length) {
          return { ok: false, error: `${deps.mcpPolicyRefusal(refused[0]!, servers[refused[0]!] as object)} Not approved: ${refused.join(", ")}.` };
        }
        const disabled = Object.fromEntries(names.map((name) => [name, { ...(servers[name] as object), enabled: false }]));
        deps.persistMcpServers({ ...current, ...disabled });
        return { ok: true, added: names };
      }, deps.cfg.mcpServers ?? {}, fetcher);
      return "error" in result ? json(res, 400, result) : json(res, 200, result);
    } finally {
      deps.mcpConfigBusy.set(false);
    }
  };
}
