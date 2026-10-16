// Task 4.1 spike: OpenCode's remote MCP reaches the gateway's /mcp with the X-AM-* headers, and
// `opencode run --format json` prints one parseable JSON event per line. Needs a running gateway
// (`pnpm dev`) and a real model key, so it is not part of `pnpm test`. `fallback` uses
// OPENROUTER_BUILD_MODEL and needs no BUILD_MODEL.
//   pnpm tsx --env-file-if-exists=.env scripts/spike-opencode.ts [agencymem|fallback]
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CreateProjectResponse, loadConfig } from "@agencymem/contracts";

const useFallback = process.argv[2] === "fallback";
// ponytail: a placeholder keeps the runner config check happy when only the fallback is used.
const cfg = loadConfig(
  useFallback ? { ...process.env, BUILD_MODEL: process.env.BUILD_MODEL || "unused" } : process.env,
  "runner",
);
const uiToken = process.env.AM_UI_TOKEN;
if (!uiToken) throw new Error("spike: AM_UI_TOKEN is required to create the spike project.");

// The session refuses an unknown project, so make a throwaway one.
const res = await fetch(`${cfg.GATEWAY_URL}/api/projects`, {
  method: "POST",
  headers: {
    "X-AM-Token": uiToken,
    "X-AM-Actor": "human:spike",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ clientName: "Spike client", projectName: "OpenCode spike", mode: "live" }),
});
if (!res.ok)
  throw new Error(`spike: POST /api/projects answered ${res.status} ${await res.text()}`);
const projectId = CreateProjectResponse.parse(await res.json()).project.id;

// ponytail: a temp folder, not a worktree; the worktree manager is task 4.3.
const dir = await mkdtemp(join(tmpdir(), "am-spike-"));
const config = {
  $schema: "https://opencode.ai/config.json",
  provider: {
    agencymem: {
      npm: "@ai-sdk/openai-compatible",
      name: "AgencyMem primary endpoint",
      options: { baseURL: "{env:LLM_BASE_URL}", apiKey: "{env:LLM_API_KEY}" },
      models: { [cfg.BUILD_MODEL!]: { name: "Build model" } },
    },
    fallback: {
      npm: "@ai-sdk/openai-compatible",
      name: "OpenRouter fallback",
      options: { baseURL: "https://openrouter.ai/api/v1", apiKey: "{env:OPENROUTER_API_KEY}" },
      models: { [cfg.OPENROUTER_BUILD_MODEL!]: { name: "Build model (fallback)" } },
    },
  },
  mcp: {
    agencymem: {
      type: "remote",
      url: "{env:GATEWAY_URL}/mcp",
      headers: {
        "X-AM-Token": "{env:AM_AGENT_TOKEN}",
        "X-AM-Agent": "build",
        "X-AM-Project": "{env:AM_PROJECT_ID}",
        "X-AM-Worker": "{env:AM_WORKER_ID}",
      },
    },
  },
  permission: { "*": "allow", webfetch: "deny", bash: { "*": "deny", "sleep *": "allow" } },
};
await writeFile(join(dir, "opencode.json"), JSON.stringify(config, null, 2));
await writeFile(
  join(dir, "AGENTS.md"),
  `# Spike\n\n- Call the get_task_context tool with taskId ${projectId}.\n` +
    "- Then run the bash command sleep 1.\n- Then stop. Do not edit any file.\n",
);

const model = useFallback
  ? `fallback/${cfg.OPENROUTER_BUILD_MODEL}`
  : `agencymem/${cfg.BUILD_MODEL}`;

// opencode is opencode.cmd on Windows, which Node runs only through a shell; the shell splits on
// spaces, so the prompt (which has no quotes) gets quoted there.
const win = process.platform === "win32";
const prompt = win ? '"Follow AGENTS.md."' : "Follow AGENTS.md.";
const child = spawn(
  "opencode",
  ["run", "--dir", dir, "--model", model, "--format", "json", "--auto", prompt],
  {
    shell: win,
    env: {
      ...process.env,
      GATEWAY_URL: cfg.GATEWAY_URL,
      AM_PROJECT_ID: projectId,
      AM_WORKER_ID: "build-spike",
      // Without this OpenCode also loads ~/.claude/CLAUDE.md and ~/.claude/skills.
      OPENCODE_DISABLE_CLAUDE_CODE: "1",
    },
    stdio: ["ignore", "pipe", "inherit"],
  },
);
// On Windows child.kill() stops only the cmd wrapper; opencode.exe keeps the pipe open.
const stop = () =>
  win ? spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]) : child.kill();
const timer = setTimeout(stop, 300_000);

let buffer = "";
const events: unknown[] = [];
const bad: string[] = [];
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk: string) => {
  buffer += chunk;
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() ?? "";
  for (const line of lines.filter((l) => l.trim())) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      events.push(event);
      console.log(`event ${String(event.type)}: ${Object.keys(event).join(", ")}`);
    } catch {
      bad.push(line);
    }
  }
});

const code = await new Promise<number | null>((done) => child.on("close", done));
clearTimeout(timer);
if (buffer.trim()) bad.push(buffer);

await writeFile(join(dir, "events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n"));
const reached = events.some((e) => {
  const text = JSON.stringify(e);
  return text.includes("get_task_context") && text.includes("is not built yet (task 4.7)");
});

console.log(`\nexit code ${code}; ${events.length} events; ${bad.length} lines not JSON`);
console.log(`events saved to ${join(dir, "events.jsonl")}`);
for (const line of bad.slice(0, 5)) console.log(`not JSON: ${line.slice(0, 200)}`);
console.log(reached ? "PASS: get_task_context reached the gateway" : "FAIL: no gateway reply seen");
process.exit(reached && bad.length === 0 ? 0 : 1);
