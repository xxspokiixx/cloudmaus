// Download one SkillMD SKILL.md and store it off. No redirects, no extra files, no execution.
import { isSkillName, SKILL_FILE_MAX_BYTES } from "../shared/skill-md.ts";
import {
  draftSkillMdInstall, parseSkillMdItems, parseSkillMdSlug, selectSkillMdItems, skillMdCatalogUrl, skillMdRawUrl, SKILLMD_FEATURED,
  SKILLMD_ORIGIN, type SkillMdItem,
} from "../shared/skillmd.ts";
import { readImportedSkills, storeImportedSkills, type ImportedSkillInput } from "./imported-skills.ts";

const USER_AGENT = "cloudmaus-skillmd";
const JSON_MAX_BYTES = 1_048_576;

export interface SkillMdInstall {
  name: string;
  description: string;
  warnings: string[];
  unreviewed: boolean;
  preview: string;
  input: ImportedSkillInput;
}

function skillMdUrl(url: string, kind: "json" | "raw"): URL {
  const parsed = new URL(url);
  if (parsed.origin !== SKILLMD_ORIGIN || parsed.username || parsed.password) {
    throw new Error("SkillMD is read from api.skillmd.com only.");
  }
  const raw = /^\/api\/skills\/[^/]+\/[^/]+\/raw$/;
  if (kind === "raw" && !raw.test(parsed.pathname)) throw new Error("SkillMD markdown uses the raw skill URL only.");
  if (kind === "json" && parsed.pathname !== "/v1/skills" && parsed.pathname !== "/v1/search") {
    throw new Error("SkillMD search uses the open read API only.");
  }
  return parsed;
}

async function readCapped(response: Response, max: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) throw new Error("That skill is larger than this app will store.");
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > max) throw new Error("That skill is larger than this app will store.");
    return bytes;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new Error("That skill is larger than this app will store.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function allowsType(header: string | null, json: boolean): boolean {
  if (!header) return !json;
  const type = header.split(";")[0]?.trim().toLowerCase() ?? "";
  if (json) return type === "application/json";
  return type === "text/plain" || type === "text/markdown" || type === "text/x-markdown";
}

async function fetchSkillMd(url: string, kind: "json" | "raw", fetcher: typeof fetch, max: number): Promise<Uint8Array> {
  skillMdUrl(url, kind);
  let response: Response;
  try {
    response = await fetcher(url, {
      redirect: "error",
      headers: {
        accept: kind === "json" ? "application/json" : "text/markdown, text/plain",
        "user-agent": USER_AGENT,
      },
    });
  } catch {
    throw new Error("SkillMD redirected or could not be reached.");
  }
  if (!response.ok) throw new Error(`SkillMD returned ${response.status}.`);
  if (!allowsType(response.headers.get("content-type"), kind === "json")) throw new Error("SkillMD install reads markdown only.");
  return readCapped(response, max);
}

async function fetchSkillMdJson(url: string, fetcher: typeof fetch): Promise<unknown> {
  const bytes = await fetchSkillMd(url, "json", fetcher, JSON_MAX_BYTES);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error("SkillMD returned an unexpected list.");
  }
}

export async function listSkillMd(
  query: string,
  verifiedOnly: boolean,
  fetcher: typeof fetch = fetch,
): Promise<{ items: SkillMdItem[]; featured: SkillMdItem[]; verifiedOnly: boolean } | { error: string }> {
  if (!query.trim() && verifiedOnly) return { items: [], featured: [...SKILLMD_FEATURED], verifiedOnly };
  const url = skillMdCatalogUrl(query);
  if (!url) return { error: "That search is not a SkillMD query." };
  try {
    const parsed = parseSkillMdItems(await fetchSkillMdJson(url, fetcher));
    if ("error" in parsed) return parsed;
    return { items: selectSkillMdItems(parsed, verifiedOnly).slice(0, 25), featured: [...SKILLMD_FEATURED], verifiedOnly };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "SkillMD could not be read." };
  }
}

/** Review status from a search hit for this exact slug. Unknown or failed lookups stay unreviewed. */
async function reviewedSlug(slug: string, name: string, fetcher: typeof fetch): Promise<boolean> {
  const url = skillMdCatalogUrl(name);
  if (!url) return false;
  try {
    const parsed = parseSkillMdItems(await fetchSkillMdJson(url, fetcher));
    if ("error" in parsed) return false;
    return parsed.some((item) => item.slug === slug && item.verified);
  } catch {
    return false;
  }
}

function storedName(name: string): string {
  const existing = readImportedSkills()[name];
  if (!existing || existing.root === "plugin:skillmd") return name;
  const prefixed = `skillmd-${name}`.slice(0, 64).replace(/-+$/g, "");
  return isSkillName(prefixed) ? prefixed : name;
}

export async function loadSkillMdInstall(slug: string, fetcher: typeof fetch = fetch): Promise<SkillMdInstall | { error: string }> {
  const parsed = parseSkillMdSlug(slug);
  const rawUrl = parsed ? skillMdRawUrl(`${parsed.owner}/${parsed.name}`) : null;
  if (!parsed || !rawUrl) return { error: "Use a SkillMD skill as owner/name." };
  const verified = await reviewedSlug(`${parsed.owner}/${parsed.name}`, parsed.name, fetcher);
  let markdown: string;
  try {
    const bytes = await fetchSkillMd(rawUrl, "raw", fetcher, SKILL_FILE_MAX_BYTES);
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) return { error: "SkillMD install reads markdown only." };
    markdown = new TextDecoder().decode(bytes);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "SkillMD could not be read." };
  }
  const draft = draftSkillMdInstall(markdown, verified);
  if ("error" in draft) return draft;
  const name = storedName(draft.name);
  if (!isSkillName(name)) return { error: "That skill name cannot be stored." };
  return {
    name,
    description: draft.description,
    warnings: draft.warnings,
    unreviewed: draft.verified !== true,
    preview: draft.preview,
    input: {
      name,
      skillMd: draft.skillMd,
      files: [],
      entry: {
        description: draft.description,
        source: "plugin",
        root: "plugin:skillmd",
        origin: `plugin:skillmd/${draft.name}`,
        label: "SkillMD",
        sha256: draft.sha256,
        warnings: draft.warnings,
      },
    },
  };
}

export async function installSkillMd(
  slug: string,
  fetcher: typeof fetch = fetch,
): Promise<{ name: string; description: string; warnings: string[]; unreviewed: boolean; preview: string; enabled: false } | { error: string }> {
  const loaded = await loadSkillMdInstall(slug, fetcher);
  if ("error" in loaded) return loaded;
  const stored = storeImportedSkills([loaded.input]);
  if (!stored[0]?.stored) return { error: "That skill could not be saved." };
  return {
    name: loaded.name,
    description: loaded.description,
    warnings: loaded.warnings,
    unreviewed: loaded.unreviewed,
    preview: loaded.preview,
    enabled: false,
  };
}
