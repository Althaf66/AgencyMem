// The runner the restart test starts and stops (task 6.2): apps/runner/src/main.ts without the model
// agents, so no model key is needed. One build worker on the fake OpenCode (FAKE_OC picks its mode)
// and the merge loop, on one project. GATEWAY_URL, AM_PROJECT_ID, WORKSPACES_DIR and HEARTBEAT_MS
// come from the test.
import { fileURLToPath } from "node:url";
import type { ModelClient } from "@agencymem/llm";
import { buildWorker } from "../../apps/runner/src/build";
import { runLoop } from "../../apps/runner/src/loop";
import { mergeJob } from "../../apps/runner/src/merge";

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const gatewayUrl = env("GATEWAY_URL");
const projectId = env("AM_PROJECT_ID");
const workspacesDir = env("WORKSPACES_DIR");
const heartbeatMs = Number(env("HEARTBEAT_MS"));
const FAKE = [
  process.execPath,
  fileURLToPath(new URL("../../apps/runner/src/opencode.fake.mjs", import.meta.url)),
];

const deps = {
  gatewayUrl,
  token: "agent-t",
  llm: {} as ModelClient, // no model agent runs here
  heartbeatMs,
  idleMs: 100,
  projects: async () => [projectId],
};
const worker = buildWorker({
  n: 1,
  bin: FAKE,
  workspacesDir,
  gatewayUrl,
  hookToken: "hook-t",
  buildModel: "vendor/primary-model",
  fallbackModel: "vendor/model",
  heartbeatMs,
  install: false,
  pendingMs: 200,
});
for (const agent of [worker, mergeJob({ workspacesDir })]) {
  void runLoop(agent, deps);
}
console.log("restart runner started");
