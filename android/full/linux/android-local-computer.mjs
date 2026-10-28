#!/usr/bin/env node
// The phone's "this computer": a minimal MCP stdio server whose tools run inside
// the proot'ed Alpine rootfs (see android-test/runtime/android-arm64/linux/).
// The harness gate (local-computer-proxy) launches it as: <node> <this file> mcp
// with OMB_ANDROID_LINUX_DIR / OMB_ANDROID_ROOTFS / OMB_ANDROID_WORKSPACE / OMB_ANDROID_TMP_DIR in env.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const LINUX = process.env.OMB_ANDROID_LINUX_DIR ?? "";
const ROOTFS = process.env.OMB_ANDROID_ROOTFS ?? join(LINUX, "rootfs");
const WORKSPACE = process.env.OMB_ANDROID_WORKSPACE ?? "";
const TMP_DIR = process.env.OMB_ANDROID_TMP_DIR ?? join(LINUX, "tmp");

const TOOL_TIMEOUT_MS = 120_000;

const TOOLS = [
  {
    name: "bash",
    description: "Run a shell command in this computer's Linux environment (Alpine, bash). The working directory is /work, the bot's workspace.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The bash command to run, e.g. `python3 script.py` or `ls -la`." },
        timeoutMs: { type: "integer", description: `Optional wall-clock limit in milliseconds, up to ${TOOL_TIMEOUT_MS}.` },
      },
      required: ["command"],
    },
  },
  {
    name: "read_file",
    description: "Read a text file from this computer. Paths resolve against /work when relative.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "File path, absolute inside the Linux env or relative to /work." } },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write a text file on this computer. Paths resolve against /work when relative. Parent folders are created.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path, absolute inside the Linux env or relative to /work." },
        content: { type: "string", description: "Full file contents to write." },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_files",
    description: "List a folder on this computer. Paths resolve against /work when relative.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Folder path; defaults to /work." } },
    },
  },
];

// Android's kernel resolves a guest binary's PT_INTERP at the host root, where
// the rootfs loader does not exist, so guest programs exec through proot's
// loader instead (PROOT_LOADER, a real file since Android denies memfd exec to
// apps): it maps the binary and its interpreter itself, from the rootfs.
// copyAssetDir strips modes, so the app restores the loader's exec bit before
// any of this can run.
function guestCommand(bashArgs) {
  return [
    join(LINUX, "proot"),
    "-R", ROOTFS,
    "-b", `${WORKSPACE}:/work`,
    "-w", "/work",
    ...bashArgs,
  ];
}

function runGuest(argv, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      env: {
        // The guest inherits this env: give it the guest's own PATH, not
        // Android's; LD_LIBRARY_PATH must name only proot's two bionic libs,
        // which no guest binary depends on by name.
        PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        HOME: "/root",
        TMPDIR: TMP_DIR,
        LD_LIBRARY_PATH: LINUX,
        PROOT_TMP_DIR: TMP_DIR,
        PROOT_NO_SECCOMP: "1",
        PROOT_ASSUME_MEMFD_UNSUPPORTED: "1",
        PROOT_LOADER: join(LINUX, "loader"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let done = false;
    const finish = (code, signal) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, signal, out });
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(-1, "SIGKILL");
    }, Math.min(timeoutMs, TOOL_TIMEOUT_MS));
    child.stdout.setEncoding("utf8").on("data", (chunk) => { out += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { out += chunk; });
    child.on("error", (error) => {
      out += `\n${error}`;
      finish(-1, undefined);
    });
    child.on("close", finish);
  });
}

async function callTool(name, input) {
  let bashArgs;
  if (name === "bash") {
    const limit = Number.isInteger(input?.timeoutMs) ? input.timeoutMs : TOOL_TIMEOUT_MS;
    bashArgs = ["/bin/bash", "-lc", String(input?.command ?? "")];
    const run = await runGuest(guestCommand(bashArgs), limit);
    const text = (run.out || "(no output)").trim();
    return { content: [{ type: "text", text }], isError: run.code !== 0 };
  }
  if (name === "read_file") {
    const path = String(input?.path ?? "/work");
    bashArgs = ["/bin/bash", "-lc", `cat -- ${shellQuote(path)}`];
    const run = await runGuest(guestCommand(bashArgs), TOOL_TIMEOUT_MS);
    return { content: [{ type: "text", text: run.out }], isError: run.code !== 0 };
  }
  if (name === "write_file") {
    const path = String(input?.path ?? "");
    const content = String(input?.content ?? "");
    mkdirSync(WORKSPACE, { recursive: true });
    bashArgs = ["/bin/bash", "-lc", `mkdir -p -- "$(dirname -- ${shellQuote(path)})" && printf %s ${shellQuote(content)} > ${shellQuote(path)} && echo "wrote ${path}"`];
    const run = await runGuest(guestCommand(bashArgs), TOOL_TIMEOUT_MS);
    return { content: [{ type: "text", text: (run.out || "").trim() || (run.code === 0 ? "wrote" : "write failed") }], isError: run.code !== 0 };
  }
  if (name === "list_files") {
    const path = input?.path === undefined || input?.path === "" ? "/work" : String(input.path);
    bashArgs = ["/bin/bash", "-lc", `ls -la -- ${shellQuote(path)}`];
    const run = await runGuest(guestCommand(bashArgs), TOOL_TIMEOUT_MS);
    return { content: [{ type: "text", text: run.out }], isError: run.code !== 0 };
  }
  return { content: [{ type: "text", text: `unknown tool: ${name}` }], isError: true };
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) handle(line);
  }
});
process.stdin.on("end", () => process.exit(0));

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function handle(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id === undefined) return; // notification
  const { method, params } = message;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "openmausbot-android-local-computer", version: "1.0.0" },
      },
    });
    return;
  }
  if (method === "ping") {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools: TOOLS } });
    return;
  }
  if (method === "tools/call") {
    callTool(String(params?.name ?? ""), params?.arguments ?? {})
      .then((result) => send({ jsonrpc: "2.0", id: message.id, result }))
      .catch((error) => send({
        jsonrpc: "2.0",
        id: message.id,
        result: { content: [{ type: "text", text: String(error?.stack ?? error) }], isError: true },
      }));
    return;
  }
  if (method === "resources/list" || method === "prompts/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { resources: [], prompts: [] } });
    return;
  }
  send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `method not found: ${method}` } });
}

process.on("uncaughtException", (error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
});
