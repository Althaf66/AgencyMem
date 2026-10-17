// A stand-in for `opencode` in opencode.test.ts. FAKE_OC picks what it does; every mode first
// prints its arguments and the variables the runner sets, as one JSON line.
const model = process.argv[process.argv.indexOf("--model") + 1] ?? "";
// 429-primary: the primary provider (agencymem/...) is rate limited and the fallback commits.
const mode =
  process.env.FAKE_OC === "429-primary"
    ? model.startsWith("agencymem/")
      ? "429"
      : "commit"
    : (process.env.FAKE_OC ?? "ok");
const say = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const step = (reason, input, output) =>
  say({ type: "step_finish", part: { reason, tokens: { input, output } } });

if (process.argv.includes("--version")) {
  process.stdout.write("1.18.32\n");
  process.exit(0);
}
say({
  type: "args",
  argv: process.argv.slice(2),
  env: {
    AM_PROJECT_ID: process.env.AM_PROJECT_ID,
    AM_WORKER_ID: process.env.AM_WORKER_ID,
    GATEWAY_URL: process.env.GATEWAY_URL,
    AM_HOOK_TOKEN: process.env.AM_HOOK_TOKEN,
    PORT: process.env.PORT,
    OPENCODE_DISABLE_CLAUDE_CODE: process.env.OPENCODE_DISABLE_CLAUDE_CODE,
    LLM_API_KEY: process.env.LLM_API_KEY,
    TOKENHARBOR_API_KEY: process.env.TOKENHARBOR_API_KEY,
    AM_UI_TOKEN: process.env.AM_UI_TOKEN,
  },
});

if (mode === "ok") {
  process.stdout.write("not json\n");
  say({
    type: "tool_use",
    part: { tool: "agencymem_get_task_context", state: { status: "completed" } },
  });
  say({
    type: "tool_use",
    part: {
      tool: "bash",
      state: { status: "completed", input: { command: "npm test" }, metadata: { exit: 0 } },
    },
  });
  step("tool-calls", 10, 2);
  step("stop", 5, 2);
  process.exit(0);
}
if (mode === "selfclose") {
  // OpenCode called complete_task itself and the gateway took it (TD build step 8).
  say({
    type: "tool_use",
    part: { tool: "agencymem_complete_task", state: { status: "completed" } },
  });
  if (process.env.FAKE_OC_LOG) {
    const { appendFileSync } = await import("node:fs");
    const line = JSON.stringify({ worker: process.env.AM_WORKER_ID });
    appendFileSync(process.env.FAKE_OC_LOG, `${line}\n`);
  }
  process.exit(0);
}
if (mode === "commit" || mode === "nocommit" || mode === "commit-hang") {
  // A build run: commit one file in the worktree (the real post-commit hook posts it), overlapping
  // with another worker's run, and log when it ran to FAKE_OC_LOG. The file is named after the card
  // (the worktree folder) and its text changes per run, so a second run on a card commits again and
  // two cards never clash at merge. commit-hang then hangs: the run the restart test stops.
  const { execFileSync } = await import("node:child_process");
  const { appendFileSync, writeFileSync } = await import("node:fs");
  const { basename } = await import("node:path");
  const dir = process.argv[process.argv.indexOf("--dir") + 1];
  const start = Date.now();
  if (mode !== "nocommit") {
    const text = `built by ${process.env.AM_WORKER_ID} at ${start}\n`;
    writeFileSync(`${dir}/built-${basename(dir)}.txt`, text);
    execFileSync("git", ["add", "-A"], { cwd: dir });
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "feat: build"], {
      cwd: dir,
      stdio: "ignore",
    });
  }
  if (mode === "commit-hang") {
    // Hangs until its runner is gone (on POSIX it runs in its own process group, so the kill of
    // the runner does not reach it).
    const parent = process.ppid;
    await new Promise(() =>
      setInterval(() => {
        try {
          process.kill(parent, 0);
        } catch {
          process.exit(1);
        }
      }, 200),
    );
  }
  await new Promise((r) => setTimeout(r, 1500));
  step("stop", 7, 3);
  if (process.env.FAKE_OC_LOG) {
    const line = { worker: process.env.AM_WORKER_ID, start, end: Date.now() };
    appendFileSync(process.env.FAKE_OC_LOG, `${JSON.stringify(line)}\n`);
  }
  process.exit(0);
}
if (mode === "429") {
  // What OpenCode 1.18.32 prints after its own retries on HTTP 429 (seen in the 4.12 probe).
  say({
    type: "error",
    error: {
      name: "APIError",
      data: { message: "Rate limit exceeded", statusCode: 429, isRetryable: true },
    },
  });
  process.exit(1);
}
if (mode === "stall") setInterval(() => step("unknown", 0, 0), 5);
if (mode === "hang") setInterval(() => {}, 1000);
if (mode === "tree") {
  // A process OpenCode started (a dev server), holding the same stdout.
  const { spawn } = await import("node:child_process");
  const kid = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" });
  say({ type: "child", pid: kid.pid });
  setInterval(() => {}, 1000);
}
