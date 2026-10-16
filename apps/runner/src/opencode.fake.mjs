// A stand-in for `opencode` in opencode.test.ts. FAKE_OC picks what it does; every mode first
// prints its arguments and the variables the runner sets, as one JSON line.
const mode = process.env.FAKE_OC ?? "ok";
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
    AM_UI_TOKEN: process.env.AM_UI_TOKEN,
  },
});

if (mode === "ok") {
  process.stdout.write("not json\n");
  say({ type: "tool_use", part: { tool: "bash", state: { status: "completed" } } });
  step("tool-calls", 10, 2);
  step("stop", 5, 2);
  process.exit(0);
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
