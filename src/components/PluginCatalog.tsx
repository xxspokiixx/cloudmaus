import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { openExternalLink } from "@/lib/app-links";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { completeMcpSignIn, mcpSignInLink, runMcpSignIn, type McpSignInStatus } from "@/lib/mcp-sign-in";
import { api, useStore } from "@/state/store";
import catalogJson from "../../shared/plugin-catalog.json";
import {
  catalogOAuthBody, catalogServerName, parsePluginCatalog, pluginActions, sameMcpUrl, type PluginCategory, type PluginEntry,
} from "../../shared/plugin-catalog";
import { openBotSettings } from "./bot-panel/panel-link";
import { PluginManualAdd } from "./PluginManualAdd";
import { WhopIcon } from "./WhopIcon";

const parsed = parsePluginCatalog(catalogJson);
export const PLUGIN_CATALOG: PluginEntry[] = Array.isArray(parsed) ? parsed : [];

const CATEGORIES: Array<PluginCategory | "all"> = ["all", "productivity", "integrations", "developer-tools", "utilities", "finance"];

interface ListedServer {
  name: string;
  url?: string;
  enabled?: boolean;
  auth?: "signed-in" | "needs-sign-in";
}

function entryConnected(entry: PluginEntry, servers: ListedServer[] | null, installed: readonly string[], whopConnected: boolean | null): boolean {
  if (installed.includes(entry.id) && entry.kind !== "connector") return true;
  if (!entry.mcp) return false;
  if (!servers) return entry.id === "whop" && whopConnected === true;
  return servers.some((server) => server.url && sameMcpUrl(server.url, entry.mcp!.url) && server.enabled === true && server.auth === "signed-in");
}

/** One marketplace grid. Connect is browser OAuth. A missing public client id is a registration note, not a form. */
export function PluginCatalog({ search, onlyConnected, whopRefresh, whopConnected, onWhopConnection }: {
  search: string;
  onlyConnected: boolean;
  whopRefresh: number;
  whopConnected: boolean | null;
  onWhopConnection?: (connected: boolean) => void;
}) {
  const { state, dispatch } = useStore();
  const [servers, setServers] = useState<ListedServer[] | null>(null);
  const [installed, setInstalled] = useState<string[]>([]);
  const [category, setCategory] = useState<PluginCategory | "all">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [flow, setFlow] = useState<{ id: string; status: McpSignInStatus } | null>(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [tokenFor, setTokenFor] = useState<string | null>(null);
  const [token, setToken] = useState("");

  useEffect(() => {
    let cancelled = false;
    void api<{ servers?: ListedServer[] }>("/api/mcp/servers")
      .then((body) => { if (!cancelled) setServers(body.servers ?? []); })
      .catch(() => { if (!cancelled) setServers([]); });
    void api<{ ids?: string[] }>("/api/plugins/skills")
      .then((body) => { if (!cancelled) setInstalled(body.ids ?? []); })
      .catch(() => { if (!cancelled) setInstalled([]); });
    return () => { cancelled = true; };
  }, [whopRefresh]);

  useEffect(() => {
    if (!onWhopConnection || !servers) return;
    const whop = servers.find((server) => server.url && sameMcpUrl(server.url, "https://mcp.whop.com/mcp"));
    onWhopConnection(Boolean(whop && whop.enabled && whop.auth === "signed-in"));
  }, [servers, onWhopConnection]);

  const query = search.trim().toLowerCase();
  const visible = PLUGIN_CATALOG.filter((entry) => {
    if (category !== "all" && entry.category !== category) return false;
    if (query && !`${entry.name} ${entry.id} ${entry.description}`.toLowerCase().includes(query)) return false;
    if (onlyConnected && !entryConnected(entry, servers, installed, whopConnected)) return false;
    return true;
  });
  if (!visible.length && (onlyConnected || query)) return null;

  const fail = (id: string, cause: unknown) => setErrors((current) => ({ ...current, [id]: cause instanceof Error ? cause.message : String(cause) }));

  async function connect(entry: PluginEntry) {
    if (!entry.mcp || busy) return;
    setErrors((current) => ({ ...current, [entry.id]: "" }));
    const known = servers ?? [];
    const name = catalogServerName(entry.id, entry.mcp.url, known);
    const existing = known.find((server) => server.name === name);
    setBusy(entry.id);
    try {
      if (!existing) {
        const oauth = catalogOAuthBody(entry.mcp);
        const body = await api<{ servers?: ListedServer[] }>("/api/mcp/servers", {
          method: "POST",
          body: JSON.stringify({
            name,
            type: entry.mcp.transport,
            url: entry.mcp.url,
            enabled: false,
            ...(oauth ? { oauth } : {}),
          }),
        });
        setServers(body.servers ?? known);
      }
      const controller = new AbortController();
      const result = await runMcpSignIn(name, {
        api,
        open: openExternalLink,
        signal: controller.signal,
        onStarted: (status) => setFlow({ id: entry.id, status }),
      });
      if (result.phase !== "succeeded") {
        if (result.phase !== "cancelled") fail(entry.id, result.message || t("plugins.toolsFailed"));
        return;
      }
      const tested = await api<{ ok?: boolean; error?: string }>(`/api/mcp/servers/${encodeURIComponent(name)}/test`, { method: "POST" });
      if (!tested.ok) {
        fail(entry.id, tested.error || t("plugins.toolsFailed"));
        return;
      }
      const enabled = await api<{ servers?: ListedServer[] }>(`/api/mcp/servers/${encodeURIComponent(name)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: true }),
      });
      setServers(enabled.servers ?? null);
    } catch (cause) {
      fail(entry.id, cause);
    } finally {
      setBusy(null);
      setFlow(null);
      setCallbackUrl("");
    }
  }

  async function disconnect(entry: PluginEntry) {
    if (!entry.mcp || !servers) return;
    const server = servers.find((item) => item.url && sameMcpUrl(item.url, entry.mcp!.url));
    if (!server) return;
    setBusy(entry.id);
    try {
      await api(`/api/mcp/servers/${encodeURIComponent(server.name)}`, { method: "PATCH", body: JSON.stringify({ enabled: false }) });
      const body = await api<{ servers?: ListedServer[] }>(`/api/mcp/servers/${encodeURIComponent(server.name)}/sign-out`, { method: "POST" });
      setServers(body.servers ?? null);
    } catch (cause) {
      fail(entry.id, cause);
    } finally {
      setBusy(null);
    }
  }

  async function saveToken(entry: PluginEntry) {
    if (!entry.mcp || !token.trim()) return;
    const name = catalogServerName(entry.id, entry.mcp.url, servers ?? []);
    setBusy(entry.id);
    try {
      await api("/api/mcp/servers", {
        method: "POST",
        body: JSON.stringify({
          name,
          type: entry.mcp.transport,
          url: entry.mcp.url,
          enabled: false,
          headers: { Authorization: `Bearer ${token.trim()}` },
        }),
      });
      setToken("");
      setTokenFor(null);
      const tested = await api<{ ok?: boolean; error?: string }>(`/api/mcp/servers/${encodeURIComponent(name)}/test`, { method: "POST" });
      if (!tested.ok) {
        fail(entry.id, tested.error || t("plugins.toolsFailed"));
        return;
      }
      const enabled = await api<{ servers?: ListedServer[] }>(`/api/mcp/servers/${encodeURIComponent(name)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: true }),
      });
      setServers(enabled.servers ?? null);
    } catch (cause) {
      fail(entry.id, cause);
    } finally {
      setBusy(null);
    }
  }

  async function install(entry: PluginEntry) {
    setBusy(entry.id);
    try {
      await api("/api/plugins/skills/install", { method: "POST", body: JSON.stringify({ id: entry.id }) });
      setInstalled((current) => current.includes(entry.id) ? current : [...current, entry.id]);
    } catch (cause) {
      fail(entry.id, cause);
    } finally {
      setBusy(null);
    }
  }

  async function removeSkills(entry: PluginEntry) {
    setBusy(entry.id);
    try {
      await api(`/api/plugins/skills/${encodeURIComponent(entry.id)}`, { method: "DELETE" });
      setInstalled((current) => current.filter((id) => id !== entry.id));
    } catch (cause) {
      fail(entry.id, cause);
    } finally {
      setBusy(null);
    }
  }

  const bots = (state.bots ?? []).filter((bot) => !bot.hidden);

  return (
    <section aria-labelledby="plugins-section-title" data-plugin-catalog>
      <div className="mb-1.5 flex min-h-7 items-center justify-between gap-3 px-2">
        <h3 id="plugins-section-title" className="min-w-0 truncate text-[14px] font-semibold leading-5 text-ink">{t("plugins.section.title")}</h3>
      </div>
      <p className="mb-3 px-2 text-[12px] leading-relaxed text-ink-secondary">{t("plugins.section.note")}</p>
      {!onlyConnected && (
        <div className="mb-3 flex flex-wrap gap-2 px-2" role="group" aria-label={t("plugins.section.title")}>
          {CATEGORIES.map((item) => (
            <button
              key={item}
              type="button"
              data-plugin-category={item}
              aria-pressed={category === item}
              onClick={() => setCategory(item)}
              className="rounded-full bg-control/70 px-3 py-1 text-[12px] font-medium text-ink hover:bg-raised-hover"
            >
              {t(`plugins.category.${item}` as LocaleKey)}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 items-start gap-x-6 gap-y-1 @xl:grid-cols-2">
        {visible.map((entry) => {
          const actions = pluginActions(entry);
          const connected = entryConnected(entry, servers, installed, whopConnected);
          const skillsInstalled = installed.includes(entry.id);
          const pending = busy === entry.id;
          const link = flow?.id === entry.id ? mcpSignInLink(flow.status.authorizationUrl) : null;
          return (
            <div key={entry.id} data-plugin-card={entry.id} className="flex min-w-0 flex-col rounded-xl px-2 py-2 transition-colors hover:bg-raised/40">
              <div className="flex items-center gap-3">
                {entry.id === "whop" ? <WhopIcon /> : (
                  <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-control text-[14px] font-semibold text-ink">{entry.name.slice(0, 1)}</span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[14px] font-semibold leading-5 text-ink">{entry.name}</span>
                    {connected && <Check size={13} strokeWidth={2.5} className="shrink-0 text-success" aria-label={t("apps.connected")} />}
                    {entry.kind === "skills" && <span className="shrink-0 text-[11px] text-ink-secondary">{t("plugins.kind.skills")}</span>}
                  </div>
                  <p className="truncate text-[13px] leading-[18px] text-ink-secondary" title={entry.description}>{entry.description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {actions.map((action) => {
                    if (action.kind === "connect") {
                      const label = entry.id === "whop"
                        ? t(connected ? "whop.disconnect" : "whop.connect")
                        : t(connected ? "connectors.disconnect" : "connectors.action.connect");
                      return (
                        <button
                          key="connect"
                          type="button"
                          aria-label={label}
                          disabled={pending}
                          onClick={() => void (connected ? disconnect(entry) : connect(entry))}
                          className="inline-flex h-7 min-w-[64px] shrink-0 items-center justify-center gap-2 rounded-full bg-control/80 px-3 text-[13px] font-medium leading-5 text-ink hover:bg-raised-hover disabled:opacity-40"
                        >
                          {pending ? <Loader2 size={14} className="animate-spin" /> : label}
                        </button>
                      );
                    }
                    if (action.kind === "register") {
                      return (
                        <a key="register" href={action.docsUrl} target="_blank" rel="noreferrer" className="inline-flex h-7 shrink-0 items-center rounded-full bg-control/80 px-3 text-[13px] font-medium leading-5 text-ink hover:bg-raised-hover">
                          {t("plugins.register")}
                        </a>
                      );
                    }
                    if (action.kind === "manual") {
                      return (
                        <a key="manual" href={action.docsUrl} target="_blank" rel="noreferrer" className="inline-flex h-7 shrink-0 items-center rounded-full bg-control/80 px-3 text-[13px] font-medium leading-5 text-ink hover:bg-raised-hover">
                          {t("plugins.manual")}
                        </a>
                      );
                    }
                    if (action.kind === "token") {
                      return (
                        <button key="token" type="button" onClick={() => setTokenFor(entry.id)} className="inline-flex h-7 shrink-0 items-center rounded-full bg-control/80 px-3 text-[13px] font-medium leading-5 text-ink">
                          {t("plugins.tokenSave")}
                        </button>
                      );
                    }
                    return (
                      <button
                        key="install"
                        type="button"
                        disabled={pending}
                        onClick={() => void (skillsInstalled ? removeSkills(entry) : install(entry))}
                        className="inline-flex h-7 shrink-0 items-center rounded-full bg-control/80 px-3 text-[13px] font-medium leading-5 text-ink hover:bg-raised-hover disabled:opacity-40"
                      >
                        {t(skillsInstalled ? "plugins.removeSkills" : "plugins.install")}
                      </button>
                    );
                  })}
                </div>
              </div>
              {errors[entry.id] && <p role="alert" className="mt-1 ps-[52px] text-[12px] text-danger">{errors[entry.id]}</p>}
              {actions.some((action) => action.kind === "register") && (
                <p className="mt-1 ps-[52px] text-[12px] text-ink-secondary">{t("plugins.registerHint")}</p>
              )}
              {tokenFor === entry.id && (
                <form className="mt-2 ps-[52px]" onSubmit={(event) => { event.preventDefault(); void saveToken(entry); }}>
                  <label className="block text-[12px] text-ink-secondary" htmlFor={`plugin-token-${entry.id}`}>{t("plugins.tokenHint")}</label>
                  <input id={`plugin-token-${entry.id}`} type="password" value={token} autoComplete="off" onChange={(event) => setToken(event.target.value)} aria-label={t("plugins.tokenLabel")} className="mt-1 w-full rounded-lg border border-hairline bg-inset px-3 py-2 text-[13px] text-ink outline-none" />
                  <button type="submit" disabled={!token.trim() || pending} className="mt-2 rounded-full bg-accent px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-40">{t("plugins.tokenSave")}</button>
                </form>
              )}
              {flow?.id === entry.id && (
                <div className="mt-2 ps-[52px] text-[12px] text-ink-secondary">
                  <p role="status">{t("plugins.signInWaiting")}</p>
                  {link && <button type="button" className="mt-1 text-accent hover:underline" onClick={() => void openExternalLink(link)}>{t("mcp.auth.openAgain")}</button>}
                  {flow.status.flowId && (
                    <form className="mt-2" onSubmit={(event) => {
                      event.preventDefault();
                      if (!flow.status.flowId) return;
                      void completeMcpSignIn(catalogServerName(entry.id, entry.mcp!.url, servers ?? []), flow.status.flowId, callbackUrl, api).catch((cause) => fail(entry.id, cause));
                    }}>
                      <input value={callbackUrl} onChange={(event) => setCallbackUrl(event.target.value)} aria-label={t("mcp.auth.callbackUrl")} placeholder="http://127.0.0.1:…/mcp-oauth/callback?…" className="w-full rounded-lg border border-hairline bg-inset px-3 py-2 text-ink outline-none" />
                    </form>
                  )}
                </div>
              )}
              {connected && entry.mcp && (
                <details className="mt-1 ps-[52px] text-[12px] text-ink-secondary">
                  <summary className="cursor-pointer">{t("plugins.access")}</summary>
                  <p className="mt-2 leading-relaxed">{t("plugins.accessHint")}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {bots.map((bot) => (
                      <button key={bot.id} type="button" onClick={() => { dispatch({ type: "togglePlugins", open: false }); openBotSettings(dispatch, "access", { botId: bot.id, page: "mcp" }); }} className="rounded-lg bg-control px-2.5 py-1.5 text-ink hover:bg-raised-hover">
                        {t("plugins.botSettings", { name: bot.name })}
                      </button>
                    ))}
                  </div>
                </details>
              )}
            </div>
          );
        })}
      </div>
      {!onlyConnected && !query && <PluginManualAdd />}
    </section>
  );
}
