import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  draftSkillMdInstall, parseSkillMdItems, parseSkillMdSlug, selectSkillMdItems, skillMdCatalogUrl,
  skillMdRawUrl, skillMdShowsUnreviewed, skillMdVerifiedOnly, SKILLMD_FEATURED, SKILLMD_UNTRUSTED_WARNING,
} from "../shared/skillmd.ts";
import { SKILL_FILE_MAX_BYTES } from "../shared/skill-md.ts";
import { DATA_DIR } from "./config.ts";
import { IMPORTED_SKILLS_DIR, importedSkillListings, importedSkillsFor, setImportedSkillEnabled } from "./imported-skills.ts";
import { installSkillMd, listSkillMd } from "./skillmd.ts";

afterEach(() => {
  rmSync(IMPORTED_SKILLS_DIR, { recursive: true, force: true });
  rmSync(join(DATA_DIR, "skill-state"), { recursive: true, force: true });
});

const markdown = `---\nname: pdf\ndescription: Read PDFs.\n---\n\nRead the file. Do not run a shell.\n`;

const searchBody = {
  q: "pdf",
  items: [
    { slug: "anthropic/pdf", title: "pdf", description: "Read PDFs.", verified: true, raw_url: "https://api.skillmd.com/api/skills/anthropic/pdf/raw" },
    { slug: "someone/pdf", title: "pdf", description: "Other.", verified: false, raw_url: "https://api.skillmd.com/api/skills/someone/pdf/raw" },
    { slug: "evil/pdf", title: "pdf", description: "Bad.", verified: true, raw_url: "https://evil.example/raw" },
    { slug: "acme/notes", title: "notes", description: "Notes.", raw_url: "https://api.skillmd.com/api/skills/acme/notes/raw" },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("SkillMD search parsing", () => {
  it("keeps reviewed skills and drops a raw URL that is not the canonical file", () => {
    const parsed = parseSkillMdItems(searchBody);
    expect(Array.isArray(parsed) ? parsed.map((item) => item.slug) : parsed).toEqual(["anthropic/pdf", "someone/pdf", "acme/notes"]);
    const items = parsed as Exclude<typeof parsed, { error: string }>;
    expect(items.find((item) => item.slug === "acme/notes")?.verified).toBe(false);
    expect(selectSkillMdItems(items).map((item) => item.slug)).toEqual(["anthropic/pdf"]);
    expect(selectSkillMdItems(items, false)).toHaveLength(3);
    expect(skillMdCatalogUrl("pdf")).toBe("https://api.skillmd.com/v1/search?q=pdf&limit=100");
    expect(skillMdCatalogUrl("pdf")).not.toContain("verified");
  });

  it("defaults to reviewed skills and badges the rest only when that filter is off", async () => {
    expect(skillMdVerifiedOnly(null)).toBe(true);
    expect(skillMdVerifiedOnly("1")).toBe(true);
    expect(skillMdVerifiedOnly("false")).toBe(false);
    const calls: string[] = [];
    const fetcher = (async (url: string) => {
      calls.push(String(url));
      return jsonResponse(searchBody);
    }) as typeof fetch;
    const reviewed = await listSkillMd("pdf", skillMdVerifiedOnly(null), fetcher);
    expect(reviewed).toMatchObject({ verifiedOnly: true, items: [{ slug: "anthropic/pdf", verified: true }] });
    const open = await listSkillMd("pdf", false, fetcher);
    if ("error" in open) throw new Error(open.error);
    expect(open.items.map((item) => item.slug)).toEqual(["anthropic/pdf", "someone/pdf", "acme/notes"]);
    expect(open.items.filter((item) => skillMdShowsUnreviewed(item, false)).map((item) => item.slug)).toEqual(["someone/pdf", "acme/notes"]);
    expect(skillMdShowsUnreviewed(open.items[0]!, true)).toBe(false);
    const featured = await listSkillMd("", true, fetcher);
    expect(calls).toHaveLength(2);
    expect(featured).toMatchObject({ items: [], featured: SKILLMD_FEATURED.map((item) => ({ slug: item.slug, verified: true })) });
  });
});

describe("SkillMD paths", () => {
  it("accepts owner/name and rejects traversal, encoding, and extra segments", () => {
    expect(parseSkillMdSlug("anthropic/pdf")).toEqual({ owner: "anthropic", name: "pdf" });
    expect(skillMdRawUrl("anthropic/pdf")).toBe("https://api.skillmd.com/api/skills/anthropic/pdf/raw");
    for (const bad of ["anthropic/../../etc/passwd", "anthropic/%2e%2e", "/etc/passwd", "anthropic/pdf/raw", "anthropic\\pdf", "anthropic/pdf?x=1", "../anthropic/pdf", "anthropic/.."]) {
      expect(parseSkillMdSlug(bad), bad).toBeNull();
      expect(skillMdRawUrl(bad), bad).toBeNull();
    }
  });
});

describe("SkillMD install", () => {
  function fetcherFor(options: { searchStatus?: number; body?: string; type?: string } = {}) {
    const urls: string[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      const href = String(url);
      urls.push(href);
      expect(new URL(href).origin).toBe("https://api.skillmd.com");
      if (href.includes("/v1/search")) {
        if (options.searchStatus) return jsonResponse({ error: "internal" }, options.searchStatus);
        return jsonResponse(searchBody);
      }
      expect(href).toBe("https://api.skillmd.com/api/skills/anthropic/pdf/raw");
      return new Response(options.body ?? markdown, { status: 200, headers: { "content-type": options.type ?? "text/markdown; charset=utf-8" } });
    }) as typeof fetch;
    return { fetcher, urls };
  }

  it("saves markdown only and leaves the skill off until it is enabled", async () => {
    const { fetcher, urls } = fetcherFor();
    const saved = await installSkillMd("anthropic/pdf", fetcher);
    expect(saved).toMatchObject({ name: "pdf", enabled: false, unreviewed: false, warnings: [SKILLMD_UNTRUSTED_WARNING] });
    expect(urls).toEqual([
      "https://api.skillmd.com/v1/search?q=pdf&limit=100",
      "https://api.skillmd.com/api/skills/anthropic/pdf/raw",
    ]);
    expect(readdirSync(join(IMPORTED_SKILLS_DIR, "pdf"))).toEqual(["SKILL.md"]);
    expect(importedSkillsFor("bot-skillmd", new Set())).toEqual([]);
    expect(importedSkillListings("bot-skillmd", new Set()).find((skill) => skill.name === "pdf")?.enabled).toBe(false);
    const enabled = setImportedSkillEnabled("bot-skillmd", "pdf", true);
    expect("error" in enabled ? enabled : enabled.enabled).toBe(true);
    expect(importedSkillsFor("bot-skillmd", new Set()).map((skill) => skill.name)).toEqual(["pdf"]);
  });

  it("treats an unconfirmed review as unreviewed and refuses anything that is not markdown", async () => {
    const failed = fetcherFor({ searchStatus: 500 });
    const saved = await installSkillMd("anthropic/pdf", failed.fetcher);
    expect(saved).toMatchObject({ unreviewed: true, enabled: false });
    expect(importedSkillsFor("bot-skillmd", new Set())).toEqual([]);

    const zip = fetcherFor({ body: "PK\u0003\u0004not-markdown" });
    expect(await installSkillMd("anthropic/pdf", zip.fetcher)).toEqual({ error: "SkillMD install reads markdown only." });
    const huge = fetcherFor({ body: `${markdown}${"x".repeat(SKILL_FILE_MAX_BYTES)}` });
    expect(await installSkillMd("anthropic/pdf", huge.fetcher)).toEqual({ error: "That skill is larger than this app will store." });
    let called = false;
    const blocked = (async () => {
      called = true;
      return new Response("", { status: 200 });
    }) as typeof fetch;
    expect(await installSkillMd("anthropic/../../etc/passwd", blocked)).toEqual({ error: "Use a SkillMD skill as owner/name." });
    expect(called).toBe(false);
    const draft = draftSkillMdInstall(markdown, true);
    expect("error" in draft ? draft : draft.warnings).toContain(SKILLMD_UNTRUSTED_WARNING);
  });
});
