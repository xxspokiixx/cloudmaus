import { useState } from "react";

import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { api } from "@/state/store";

type ManualKind = "github" | "folder" | "mcp" | "skills" | "skillmd";

const KIND_LABEL: Record<ManualKind, LocaleKey> = {
  github: "plugins.manual.github",
  folder: "plugins.manual.folder",
  mcp: "plugins.manual.mcp",
  skills: "plugins.manual.skills",
  skillmd: "plugins.manual.skillmd",
};

interface Preview {
  servers: Array<{ name: string; target: string; transport: string; headerNames: string[] }>;
  skills: Array<{ name: string; description: string; warnings: string[]; unreviewed?: boolean; preview?: string }>;
  skipped: string[];
}

const KINDS: ManualKind[] = ["github", "folder", "mcp", "skills", "skillmd"];

/** Preview a plugin, then import it. MCP servers stay disabled. Header values are not shown again. */
export function PluginManualAdd() {
  const [kind, setKind] = useState<ManualKind>("github");
  const [source, setSource] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<string | null>(null);

  const run = async (path: "/api/plugins/preview" | "/api/plugins/import") => {
    setBusy(path.endsWith("preview") ? "preview" : "import");
    setError(null);
    setImported(null);
    try {
      if (path.endsWith("preview")) {
        setPreview(await api<Preview>(path, { method: "POST", body: JSON.stringify({ kind, source }) }));
      } else {
        const result = await api<{ added: string[]; skills: Array<{ name: string; stored: boolean }> }>(path, {
          method: "POST",
          body: JSON.stringify({ kind, source }),
        });
        setPreview(null);
        setSource("");
        const servers = result.added.join(", ");
        const skills = result.skills.filter((skill) => skill.stored).map((skill) => skill.name).join(", ");
        setImported([servers && t("plugins.manual.doneServers", { names: servers }), skills && t("plugins.manual.doneSkills", { names: skills })].filter(Boolean).join(" ") || t("plugins.preview.empty"));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section id="plugin-manual" className="mt-6 rounded-xl border border-hairline/40 px-4 py-3" aria-labelledby="plugin-manual-title">
      <p id="plugin-manual-title" className="text-[14px] font-semibold text-ink">{t("plugins.manual.title")}</p>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{t("plugins.manual.intro")}</p>
      {kind === "skillmd" && <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{t("plugins.skillmd.manualNote")}</p>}
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t("plugins.manual.title")}>
        {KINDS.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={kind === item}
            onClick={() => { setKind(item); setPreview(null); }}
            className="rounded-full bg-control/70 px-3 py-1 text-[12px] font-medium text-ink hover:bg-raised-hover"
          >
            {t(KIND_LABEL[item])}
          </button>
        ))}
      </div>
      {kind === "mcp" ? (
        <textarea
          value={source}
          onChange={(event) => setSource(event.target.value)}
          rows={5}
          spellCheck={false}
          aria-label={t("plugins.manual.mcp")}
          className="mt-3 w-full rounded-lg border border-hairline bg-inset px-3 py-2 font-mono text-[12px] text-ink outline-none focus:border-accent"
        />
      ) : (
        <input
          value={source}
          onChange={(event) => setSource(event.target.value)}
          aria-label={t(KIND_LABEL[kind])}
          autoComplete="off"
          spellCheck={false}
          className="mt-3 w-full rounded-lg border border-hairline bg-inset px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
        />
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={!source.trim() || busy !== null} onClick={() => void run("/api/plugins/preview")} className="rounded-full bg-control px-3 py-1.5 text-[13px] font-medium text-ink disabled:opacity-40">
          {t("plugins.manual.preview")}
        </button>
        <button type="button" disabled={!preview || busy !== null || (preview.servers.length === 0 && preview.skills.length === 0)} onClick={() => void run("/api/plugins/import")} className="rounded-full bg-accent px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-40">
          {t("plugins.manual.import")}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
      {imported && <p role="status" className="mt-2 text-[12px] text-success">{imported}</p>}
      {preview && (
        <div className="mt-3 text-[12px] leading-relaxed text-ink-secondary">
          <p>{t("plugins.manual.mcpOff")}</p>
          {preview.servers.length > 0 && (
            <ul className="mt-2 space-y-1">
              {preview.servers.map((server) => (
                <li key={server.name}>
                  <span className="font-medium text-ink">{server.name}</span> · {server.transport} · {server.target}
                  {server.headerNames.length > 0 ? ` · ${server.headerNames.join(", ")}` : ""}
                </li>
              ))}
            </ul>
          )}
          {preview.skills.length > 0 && (
            <ul className="mt-2 space-y-1">
              {preview.skills.map((skill) => (
                <li key={skill.name}>
                  <span className="font-medium text-ink">{skill.name}</span> — {skill.description}
                  {skill.unreviewed ? ` · ${t("plugins.skillmd.unreviewed")}` : ""}
                  {skill.warnings.length > 0 ? ` (${skill.warnings.length})` : ""}
                  {skill.preview && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-inset p-2 font-mono text-[11px] text-ink">{skill.preview}</pre>}
                </li>
              ))}
            </ul>
          )}
          {preview.servers.length === 0 && preview.skills.length === 0 && <p className="mt-2">{t("plugins.preview.empty")}</p>}
          {preview.skipped.map((line) => <p key={line} className="mt-1 text-warning">{line}</p>)}
        </div>
      )}
    </section>
  );
}
