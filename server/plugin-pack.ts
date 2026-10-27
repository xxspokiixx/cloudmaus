// Read a Cursor-style plugin (GitHub or a local folder) or install one skills pack from the catalog.
// Markdown only. Nothing in the pack is executed, and imported MCP servers stay disabled until a person tests them.
import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { parsePluginCatalog, type PluginEntry, type PluginSkillsSource } from "../shared/plugin-catalog.ts";
import { isSkillName, parseSkillMd, scanSkillText, SKILL_FILE_MAX_BYTES } from "../shared/skill-md.ts";
import {
  forgetImportedSkillsByRoot, readImportedSkills, storeImportedSkills, type ImportedSkillEntry, type ImportedSkillInput,
} from "./imported-skills.ts";
import { parseMcpServersImport } from "./mcp-registry.ts";
import { parseSkillSource } from "./skill-fetch.ts";

const CATALOG_PATH = fileURLToPath(new URL("../shared/plugin-catalog.json", import.meta.url));
const MAX_PLUGIN_SKILLS = 80;
const MAX_FILES_PER_SKILL = 30;
const MAX_LOCAL_FILES = 200;
const MAX_DEPTH = 6;
const API = "https://api.github.com";

export function loadPluginCatalog(): PluginEntry[] {
  const parsed = parsePluginCatalog(JSON.parse(readFileSync(CATALOG_PATH, "utf8")));
  if (!Array.isArray(parsed)) throw new Error(parsed.error);
  return parsed;
}

export function pluginCatalogEntry(id: string): PluginEntry | undefined {
  return loadPluginCatalog().find((entry) => entry.id === id);
}

export interface PluginPreviewServer {
  name: string;
  /** URL or command. Header and environment values are never included. */
  target: string;
  transport: "http" | "sse" | "stdio";
  headerNames: string[];
}

export interface PluginPreviewSkill {
  name: string;
  description: string;
  warnings: string[];
}

export interface PluginPreview {
  servers: PluginPreviewServer[];
  skills: PluginPreviewSkill[];
  skipped: string[];
}

export interface PreparedSkill {
  name: string;
  description: string;
  warnings: string[];
  input: ImportedSkillInput;
}

const PLACEHOLDER = /\$\{[^}\n]+\}|^\$[A-Za-z_][A-Za-z0-9_]*$|^(?:YOUR|MY|REPLACE|TODO)[-_][A-Z0-9_-]+$|^<[^>\n]+>$/i;

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Drop placeholder header and environment values. A URL that is still a placeholder is not imported. */
export function sanitizeMcpConfig(text: string): { text: string; skipped: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { text, skipped: [] };
  }
  if (!isRecord(parsed)) return { text, skipped: [] };
  const skipped: string[] = [];
  const cleanValue = (value: unknown) => typeof value === "string" && PLACEHOLDER.test(value.trim());
  const cleanMap = (value: unknown) => {
    if (!isRecord(value)) return;
    for (const [key, entry] of Object.entries(value)) if (cleanValue(entry)) delete value[key];
  };
  const placeholderUrl = (entry: Record<string, unknown>) =>
    typeof entry.url === "string" && (entry.url.includes("${") || PLACEHOLDER.test(entry.url.trim()));
  const cleanServer = (name: string, entry: unknown): boolean => {
    if (!isRecord(entry)) return false;
    cleanMap(entry.headers);
    cleanMap(entry.env);
    delete entry.enabled;
    delete entry.oauth;
    if (!placeholderUrl(entry)) return false;
    skipped.push(`${name}: the address is still a placeholder`);
    return true;
  };
  const root = parsed;
  const wrapped = isRecord(root.mcpServers);
  const servers = wrapped ? root.mcpServers as Record<string, unknown> : root;
  if (!wrapped && (typeof root.command === "string" || typeof root.url === "string")) {
    if (cleanServer(typeof root.name === "string" ? root.name : "server", root)) delete root.url;
  } else {
    for (const [name, entry] of Object.entries(servers)) if (cleanServer(name, entry)) delete servers[name];
  }
  return { text: JSON.stringify(parsed), skipped };
}

function serverTarget(entry: Record<string, unknown>): { target: string; transport: PluginPreviewServer["transport"]; headerNames: string[] } | null {
  const headerNames = isRecord(entry.headers) ? Object.keys(entry.headers).sort() : [];
  if (typeof entry.url === "string" && entry.url) {
    return { target: entry.url, transport: entry.type === "sse" ? "sse" : "http", headerNames };
  }
  if (typeof entry.command === "string" && entry.command) return { target: entry.command, transport: "stdio", headerNames };
  return null;
}

export function previewMcpText(text: string): { servers: PluginPreviewServer[]; skipped: string[]; importText: string } {
  const sanitized = sanitizeMcpConfig(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(sanitized.text);
  } catch {
    return { servers: [], skipped: ["That is not valid JSON."], importText: sanitized.text };
  }
  const imported = parseMcpServersImport(sanitized.text);
  if (!imported.ok) return { servers: [], skipped: [...sanitized.skipped, imported.error], importText: sanitized.text };
  const rawServers = isRecord(parsed) && isRecord(parsed.mcpServers) ? parsed.mcpServers : parsed;
  const servers: PluginPreviewServer[] = [];
  for (const name of Object.keys(imported.servers)) {
    const raw = isRecord(rawServers) ? rawServers[name] : undefined;
    const described = isRecord(raw) ? serverTarget(raw) : null;
    if (!described) {
      sanitized.skipped.push(`${name}: nothing to connect to`);
      continue;
    }
    servers.push({ name, ...described });
  }
  return { servers, skipped: sanitized.skipped, importText: sanitized.text };
}

function skillWarnings(skillMd: string, files: readonly { path: string; content: string }[]): string[] {
  const all = [...scanSkillText(skillMd), ...files.flatMap((file) => scanSkillText(file.content).map((warning) => `${file.path}: ${warning}`))];
  return [...new Set(all)].slice(0, 20);
}

function preparedSkill(pluginId: string, pluginName: string, skillMd: string, files: { path: string; content: string }[]): PreparedSkill | { skip: string } {
  const parsed = parseSkillMd(skillMd);
  if ("error" in parsed) return { skip: parsed.error };
  const warnings = skillWarnings(skillMd, files);
  const name = storedSkillName(pluginId, parsed.name);
  if (!isSkillName(name)) return { skip: `${parsed.name} is not a skill name this app can store` };
  const input: ImportedSkillInput = {
    name,
    skillMd,
    files: files.slice(0, MAX_FILES_PER_SKILL - 1).map((file) => ({ path: file.path, content: file.content, executable: false })),
    entry: {
      description: parsed.description,
      source: "plugin",
      root: `plugin:${pluginId}`,
      origin: `plugin:${pluginId}/${parsed.name}`,
      label: pluginName,
      sha256: sha256(skillMd),
      warnings,
      ...(parsed.license ? { license: parsed.license } : {}),
      ...(parsed.compatibility ? { compatibility: parsed.compatibility } : {}),
    },
  };
  return { name, description: parsed.description, warnings, input };
}

/** Keep the skill's own name unless another pack already stored it. */
function storedSkillName(pluginId: string, name: string): string {
  const root = `plugin:${pluginId}`;
  const existing = readImportedSkills()[name];
  if (!existing || existing.root === root) return name;
  const prefixed = `${pluginId}-${name}`.slice(0, 64).replace(/-+$/g, "");
  return isSkillName(prefixed) ? prefixed : name;
}

function readNoFollow(path: string): string | null {
  let fd: number | null = null;
  try {
    fd = openSync(path, constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW));
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > SKILL_FILE_MAX_BYTES) return null;
    return readFileSync(fd, "utf8");
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try { closeSync(fd); } catch { /* already closed */ }
    }
  }
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** A real directory, never a symlink, and only the plugin files we understand. */
export function readLocalPlugin(root: string, pluginId: string, pluginName: string): { mcpText: string | null; skills: PreparedSkill[]; skipped: string[] } {
  if (!isAbsolute(root)) return { mcpText: null, skills: [], skipped: ["Use a full path to a folder on this computer."] };
  const resolved = resolve(root);
  let info;
  try {
    info = lstatSync(resolved);
  } catch {
    return { mcpText: null, skills: [], skipped: ["That folder could not be read."] };
  }
  if (info.isSymbolicLink() || !info.isDirectory()) return { mcpText: null, skills: [], skipped: ["That path is not a real folder."] };
  const skipped: string[] = [];
  const mcpText = readNoFollow(join(resolved, "mcp.json"));
  const skills: PreparedSkill[] = [];
  let seen = 0;
  const consider = (dir: string) => {
    if (skills.length >= MAX_PLUGIN_SKILLS) return;
    const skillMd = readNoFollow(join(dir, "SKILL.md"));
    if (skillMd === null) return;
    const files: { path: string; content: string }[] = [];
    const take = (folder: string, prefix: string) => {
      let names: string[] = [];
      try {
        names = readdirSync(folder);
      } catch {
        return;
      }
      for (const fileName of names) {
        if (files.length >= MAX_FILES_PER_SKILL) break;
        if (!fileName.endsWith(".md") || fileName === "SKILL.md") continue;
        const full = join(folder, fileName);
        if (!inside(resolved, full)) continue;
        let child;
        try {
          child = lstatSync(full);
        } catch {
          continue;
        }
        if (child.isSymbolicLink() || !child.isFile()) continue;
        const content = readNoFollow(full);
        if (content === null) {
          skipped.push(`${prefix}${fileName} was left out`);
          continue;
        }
        files.push({ path: `${prefix}${fileName}`, content });
      }
    };
    take(dir, "");
    const references = join(dir, "references");
    try {
      if (lstatSync(references).isDirectory() && !lstatSync(references).isSymbolicLink()) take(references, "references/");
    } catch { /* no references folder */ }
    const prepared = preparedSkill(pluginId, pluginName, skillMd, files);
    if ("skip" in prepared) skipped.push(prepared.skip);
    else skills.push(prepared);
  };
  const walk = (dir: string, depth: number) => {
    if (depth > MAX_DEPTH || seen > MAX_LOCAL_FILES || skills.length >= MAX_PLUGIN_SKILLS) return;
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    if (names.includes("SKILL.md")) consider(dir);
    for (const name of names) {
      if (name === "node_modules" || name === ".git" || name === "scripts" || name === "hooks" || name === "bin") continue;
      const full = join(dir, name);
      if (!inside(resolved, full)) continue;
      seen += 1;
      let child;
      try {
        child = lstatSync(full);
      } catch {
        continue;
      }
      if (child.isSymbolicLink() || !child.isDirectory()) continue;
      if (sep === "\\" ? false : child.isSymbolicLink()) continue;
      walk(full, depth + 1);
    }
  };
  walk(resolved, 0);
  return { mcpText, skills, skipped };
}

async function githubJson(url: string, fetcher: typeof fetch): Promise<unknown> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "api.github.com" || parsed.username || parsed.password || parsed.port) {
    throw new Error("plugin files are read from GitHub only");
  }
  const response = await fetcher(url, {
    headers: { accept: "application/vnd.github+json", "user-agent": "OpenMausBot-plugins" },
    redirect: "error",
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}`);
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error("GitHub response is too large");
  return JSON.parse(text) as unknown;
}

async function rawText(url: string, fetcher: typeof fetch): Promise<string> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "raw.githubusercontent.com" || parsed.username || parsed.password || parsed.port) {
    throw new Error("skill files must come from raw.githubusercontent.com");
  }
  const response = await fetcher(url, { headers: { "user-agent": "OpenMausBot-plugins" }, redirect: "error" });
  if (!response.ok) throw new Error(`download failed (${response.status})`);
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > SKILL_FILE_MAX_BYTES) throw new Error("file is larger than the 256KB import cap");
  return text;
}

interface GitBlob { path: string; type: string }

function asList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

async function defaultBranch(owner: string, repo: string, fetcher: typeof fetch): Promise<string> {
  const body = await githubJson(`${API}/repos/${owner}/${repo}`, fetcher);
  const branch = isRecord(body) && typeof body.default_branch === "string" ? body.default_branch : "";
  if (!/^[\w./-]+$/.test(branch)) throw new Error("GitHub did not name a branch");
  return branch;
}

function rawUrl(owner: string, repo: string, ref: string, path: string): string {
  const clean = path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${clean}`;
}

async function downloadSkillFiles(
  owner: string, repo: string, ref: string, dir: string, blobs: readonly GitBlob[], fetcher: typeof fetch,
): Promise<{ skillMd: string; files: { path: string; content: string }[] } | { skip: string }> {
  const prefix = dir ? `${dir}/` : "";
  const wanted = blobs.filter((blob) => {
    if (blob.type !== "blob" || !blob.path.endsWith(".md")) return false;
    if (!blob.path.startsWith(prefix)) return false;
    const rest = blob.path.slice(prefix.length);
    return rest === "SKILL.md" || (!rest.includes("/") && rest.endsWith(".md")) || /^references\/[^/]+\.md$/.test(rest);
  }).slice(0, MAX_FILES_PER_SKILL);
  const skill = wanted.find((blob) => blob.path === `${prefix}SKILL.md`);
  if (!skill) return { skip: `no SKILL.md in ${dir || "the repository"}` };
  try {
    const skillMd = await rawText(rawUrl(owner, repo, ref, skill.path), fetcher);
    const files: { path: string; content: string }[] = [];
    for (const blob of wanted) {
      if (blob === skill) continue;
      const rel = blob.path.slice(prefix.length);
      files.push({ path: rel, content: await rawText(rawUrl(owner, repo, ref, blob.path), fetcher) });
    }
    return { skillMd, files };
  } catch (error) {
    return { skip: error instanceof Error ? error.message : String(error) };
  }
}

async function readGitHubPlugin(
  source: PluginSkillsSource & { ref?: string }, pluginId: string, pluginName: string, fetcher: typeof fetch, skillsOnly: boolean,
): Promise<{ mcpText: string | null; skills: PreparedSkill[]; skipped: string[] }> {
  const ref = source.ref || await defaultBranch(source.owner, source.repo, fetcher);
  const listingUrl = `${API}/repos/${source.owner}/${source.repo}/contents/${source.path.split("/").filter(Boolean).map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`;
  const listing = await githubJson(listingUrl, fetcher);
  const entries = asList(listing);
  const skipped: string[] = [];
  let mcpText: string | null = null;
  if (!skillsOnly) {
    const mcp = entries.find((entry) => entry.name === "mcp.json" && entry.type === "file" && typeof entry.download_url === "string");
    if (mcp && typeof mcp.download_url === "string") {
      try {
        mcpText = await rawText(mcp.download_url, fetcher);
      } catch (error) {
        skipped.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  const skills: PreparedSkill[] = [];
  const direct = entries.find((entry) => entry.name === "SKILL.md" && entry.type === "file");
  const blobs: GitBlob[] = entries
    .filter((entry) => entry.type === "file" && typeof entry.path === "string")
    .map((entry) => ({ path: String(entry.path), type: "blob" }));
  const addFrom = async (dir: string, available: readonly GitBlob[]) => {
    if (skills.length >= MAX_PLUGIN_SKILLS) return;
    const downloaded = await downloadSkillFiles(source.owner, source.repo, ref, dir, available, fetcher);
    if ("skip" in downloaded) {
      skipped.push(downloaded.skip);
      return;
    }
    const prepared = preparedSkill(pluginId, pluginName, downloaded.skillMd, downloaded.files);
    if ("skip" in prepared) skipped.push(prepared.skip);
    else skills.push(prepared);
  };
  if (direct) await addFrom(source.path, blobs);
  const skillsDir = entries.find((entry) => entry.name === "skills" && entry.type === "dir" && typeof entry.sha === "string");
  if (skillsDir && typeof skillsDir.sha === "string" && skills.length < MAX_PLUGIN_SKILLS) {
    const tree = await githubJson(`${API}/repos/${source.owner}/${source.repo}/git/trees/${skillsDir.sha}?recursive=1`, fetcher);
    if (isRecord(tree) && tree.truncated === true) skipped.push("That skills folder is too large to read in one pass.");
    const treeBlobs = asList(isRecord(tree) ? tree.tree : []).flatMap((entry) => (
      typeof entry.path === "string" && entry.type === "blob" ? [{ path: `${source.path ? `${source.path}/` : ""}skills/${entry.path}`, type: "blob" }] : []
    ));
    const dirs = [...new Set(treeBlobs.filter((blob) => blob.path.endsWith("/SKILL.md") || blob.path.endsWith("SKILL.md")).map((blob) => blob.path.slice(0, -"/SKILL.md".length)))];
    for (const dir of dirs) {
      if (skills.length >= MAX_PLUGIN_SKILLS) {
        skipped.push(`Stopped after ${MAX_PLUGIN_SKILLS} skills.`);
        break;
      }
      await addFrom(dir, treeBlobs);
    }
  }
  return { mcpText, skills, skipped };
}

export interface ManualPluginRequest {
  kind: "github" | "folder" | "mcp" | "skills";
  source: string;
}

export function parseManualPluginRequest(value: unknown): ManualPluginRequest | { error: string } {
  if (!isRecord(value)) return { error: "Expected a plugin source." };
  if (value.kind !== "github" && value.kind !== "folder" && value.kind !== "mcp" && value.kind !== "skills") {
    return { error: "Choose a GitHub plugin, a folder, an mcpServers block, or a skills folder." };
  }
  if (typeof value.source !== "string" || !value.source.trim() || value.source.length > 100_000) {
    return { error: "Paste the plugin source first." };
  }
  return { kind: value.kind, source: value.source.trim() };
}

async function collect(request: ManualPluginRequest, fetcher: typeof fetch): Promise<{ mcpText: string | null; skills: PreparedSkill[]; skipped: string[] }> {
  if (request.kind === "mcp") return { mcpText: request.source, skills: [], skipped: [] };
  if (request.kind === "folder" || (request.kind === "skills" && isAbsolute(request.source))) {
    const read = readLocalPlugin(request.source, "manual", "Imported plugin");
    return request.kind === "skills" ? { ...read, mcpText: null } : read;
  }
  const parsed = parseSkillSource(request.source);
  if ("error" in parsed) return { mcpText: null, skills: [], skipped: [parsed.error] };
  if ("rawUrl" in parsed) {
    try {
      const skillMd = await rawText(parsed.rawUrl, fetcher);
      const prepared = preparedSkill("manual", "Imported plugin", skillMd, []);
      return "skip" in prepared
        ? { mcpText: null, skills: [], skipped: [prepared.skip] }
        : { mcpText: null, skills: [prepared], skipped: [] };
    } catch (error) {
      return { mcpText: null, skills: [], skipped: [error instanceof Error ? error.message : String(error)] };
    }
  }
  try {
    return await readGitHubPlugin(
      { owner: parsed.owner, repo: parsed.repo, path: parsed.path, ...(parsed.ref ? { ref: parsed.ref } : {}) },
      "manual",
      "Imported plugin",
      fetcher,
      request.kind === "skills",
    );
  } catch (error) {
    return { mcpText: null, skills: [], skipped: [error instanceof Error ? error.message : String(error)] };
  }
}

function toPreview(collected: { mcpText: string | null; skills: PreparedSkill[]; skipped: string[] }): PluginPreview & { importText: string | null; prepared: PreparedSkill[] } {
  const mcp = collected.mcpText ? previewMcpText(collected.mcpText) : { servers: [], skipped: [], importText: null as string | null };
  return {
    servers: mcp.servers,
    skills: collected.skills.map(({ name, description, warnings }) => ({ name, description, warnings })),
    skipped: [...collected.skipped, ...mcp.skipped],
    importText: collected.mcpText ? mcp.importText : null,
    prepared: collected.skills,
  };
}

export async function previewManualPlugin(request: ManualPluginRequest, fetcher: typeof fetch = fetch): Promise<PluginPreview> {
  const preview = toPreview(await collect(request, fetcher));
  return { servers: preview.servers, skills: preview.skills, skipped: preview.skipped };
}

export interface PluginImportResult {
  added: string[];
  skills: Array<{ name: string; stored: boolean }>;
  skipped: string[];
}

export async function importManualPlugin(
  request: ManualPluginRequest,
  persist: (servers: Record<string, unknown>, current: Record<string, unknown>) => { ok: true; added: string[] } | { ok: false; error: string },
  current: Record<string, unknown>,
  fetcher: typeof fetch = fetch,
): Promise<PluginImportResult | { error: string }> {
  const collected = toPreview(await collect(request, fetcher));
  let added: string[] = [];
  if (collected.importText && collected.servers.length) {
    const imported = parseMcpServersImport(collected.importText);
    if (!imported.ok) return { error: imported.error };
    const saved = persist(imported.servers, current);
    if (!saved.ok) return { error: saved.error };
    added = saved.added;
  }
  const stored = collected.prepared.length ? storeImportedSkills(collected.prepared.map((skill) => skill.input)) : [];
  return {
    added,
    skills: stored.map((result) => ({ name: result.name, stored: result.stored })),
    skipped: collected.skipped,
  };
}

export async function installCatalogSkills(id: string, fetcher: typeof fetch = fetch): Promise<{ installed: string[]; flagged: string[]; skipped: string[] } | { error: string }> {
  const entry = pluginCatalogEntry(id);
  if (!entry?.skills) return { error: "That plugin has no skills pack." };
  let collected;
  try {
    collected = await readGitHubPlugin(entry.skills, entry.id, entry.name, fetcher, true);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  if (!collected.skills.length) return { error: collected.skipped[0] ?? "No SKILL.md files were found." };
  const stored = storeImportedSkills(collected.skills.map((skill) => skill.input));
  const kept = new Set(stored.filter((result) => result.stored).map((result) => result.name));
  forgetImportedSkillsByRoot(`plugin:${entry.id}`, kept);
  return {
    installed: stored.filter((result) => result.stored).map((result) => result.name),
    flagged: collected.skills.filter((skill) => skill.warnings.length).map((skill) => skill.name),
    skipped: [...collected.skipped, ...stored.filter((result) => !result.stored).map((result) => result.name)],
  };
}

export function installedPluginIds(): string[] {
  const ids = new Set<string>();
  for (const entry of Object.values(readImportedSkills()) as ImportedSkillEntry[]) {
    if (entry.root.startsWith("plugin:")) ids.add(entry.root.slice("plugin:".length));
  }
  return [...ids].sort();
}

export function removeCatalogSkills(id: string): string[] {
  if (!/^[\w.-]+$/.test(id)) return [];
  return forgetImportedSkillsByRoot(`plugin:${id}`);
}
