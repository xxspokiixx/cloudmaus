import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { api } from "@/state/store";

interface SkillMdRow {
  slug: string;
  title: string;
  description: string;
  verified: boolean;
}

interface SkillMdList {
  items: SkillMdRow[];
  featured: SkillMdRow[];
  verifiedOnly: boolean;
}

interface SavedSkill {
  name: string;
  preview: string;
  unreviewed: boolean;
  enabled: false;
  warnings: string[];
}

/** Search SkillMD. Reviewed skills are the default. A save stores markdown and leaves the skill off. */
export function SkillMdBrowse() {
  const [query, setQuery] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(true);
  const [list, setList] = useState<SkillMdList | null>(null);
  const [saved, setSaved] = useState<SavedSkill | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (q: string, reviewed: boolean) => {
    setBusy("search");
    setError(null);
    try {
      const params = new URLSearchParams({ q, verified: reviewed ? "1" : "0" });
      setList(await api<SkillMdList>(`/api/plugins/skillmd?${params}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    void load("", true);
  }, []);

  const install = async (slug: string) => {
    setBusy(slug);
    setError(null);
    setSaved(null);
    try {
      setSaved(await api<SavedSkill>("/api/plugins/skillmd/install", { method: "POST", body: JSON.stringify({ slug }) }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const rows = (items: SkillMdRow[], badge: boolean) => items.map((item) => (
    <li key={item.slug} className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[13px] text-ink">{item.slug}</span>
          {badge && !item.verified && (
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning">{t("plugins.skillmd.unreviewed")}</span>
          )}
        </div>
        <p className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">{item.description}</p>
      </div>
      <button type="button" disabled={busy !== null} onClick={() => void install(item.slug)} className="shrink-0 rounded-full bg-control px-3 py-1 text-[12px] font-medium text-ink disabled:opacity-40">
        {t("plugins.skillmd.install")}
      </button>
    </li>
  ));

  const searching = query.trim().length > 0;

  return (
    <section className="mt-6 rounded-xl border border-hairline/40 px-4 py-3" aria-labelledby="skillmd-browse-title">
      <div className="flex items-center justify-between gap-3">
        <p id="skillmd-browse-title" className="text-[14px] font-semibold text-ink">{t("plugins.skillmd.title")}</p>
        <a href="https://skillmd.com/docs/mcp" target="_blank" rel="noreferrer" className="text-[12px] text-accent hover:underline">{t("plugins.skillmd.docs")}</a>
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{t("plugins.skillmd.intro")}</p>
      <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); void load(query, verifiedOnly); }}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t("plugins.skillmd.search")}
          autoComplete="off"
          spellCheck={false}
          className="min-w-[12rem] flex-1 rounded-lg border border-hairline bg-inset px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
        />
        <button type="submit" disabled={busy !== null} className="rounded-full bg-control px-3 py-1.5 text-[13px] font-medium text-ink disabled:opacity-40">{t("plugins.skillmd.search")}</button>
        <label className="flex items-center gap-2 text-[12px] text-ink">
          <input
            type="checkbox"
            checked={verifiedOnly}
            onChange={(event) => {
              setVerifiedOnly(event.target.checked);
              void load(query, event.target.checked);
            }}
          />
          {t("plugins.skillmd.reviewedOnly")}
        </label>
      </form>
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
      {list && !searching && (
        <div className="mt-3">
          <p className="text-[12px] font-medium text-ink">{t("plugins.skillmd.featured")}</p>
          <ul className="divide-y divide-hairline/40">{rows(list.featured, false)}</ul>
        </div>
      )}
      {list && (searching || !verifiedOnly) && (
        list.items.length > 0
          ? <ul className="mt-2 divide-y divide-hairline/40">{rows(list.items, !verifiedOnly)}</ul>
          : <p className="mt-3 text-[12px] text-ink-secondary">{t("plugins.skillmd.empty")}</p>
      )}
      {saved && (
        <div className="mt-3">
          <p role="status" className="text-[12px] text-ink">{saved.name}. {t("plugins.skillmd.savedOff")}</p>
          {saved.unreviewed && <p className="mt-1 text-[12px] font-medium text-warning">{t("plugins.skillmd.unreviewed")}</p>}
          {saved.warnings.length > 0 && <p className="mt-1 text-[12px] text-warning">{saved.warnings.join(" · ")}</p>}
          <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-inset p-3 font-mono text-[12px] leading-relaxed text-ink">{saved.preview}</pre>
        </div>
      )}
    </section>
  );
}
