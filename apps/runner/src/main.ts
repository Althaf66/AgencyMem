// The runner: one loop per model agent, each working on every open project through the gateway.
import { loadConfig } from "@agencymem/contracts";
import { createChat, createModelClient } from "@agencymem/llm";
import type { Agent, Job } from "./agent";
import { AGENTS } from "./agents";
import { e2eJob } from "./agents/test/run-all";
import { testRunJob } from "./agents/test/run-tests";
import { writeTestsAgent } from "./agents/test/write-tests";
import { buildWorker } from "./build";
import { runLoop, type Worker } from "./loop";
import { mergeJob } from "./merge";
import { checkOpenCodeVersion, opencodeBin } from "./opencode";
import { assertWorkspacesOutside } from "./opencode-config";

try {
  const cfg = loadConfig(process.env, "runner");
  assertWorkspacesOutside(cfg.WORKSPACES_DIR!);
  const bin = await opencodeBin();
  await checkOpenCodeVersion(bin, cfg.OPENCODE_VERSION!);
  const llm = createModelClient({ chat: createChat(cfg) });
  const deps = {
    gatewayUrl: cfg.GATEWAY_URL!,
    token: cfg.AM_AGENT_TOKEN!,
    llm,
    heartbeatMs: cfg.HEARTBEAT_MS!,
  };
  // The Test agent works in the project repositories under WORKSPACES_DIR.
  const agents: (Agent<unknown> | Job | Worker)[] = [
    ...AGENTS,
    writeTestsAgent({
      workspacesDir: cfg.WORKSPACES_DIR!,
      gatewayUrl: cfg.GATEWAY_URL!,
      hookToken: cfg.AM_HOOK_TOKEN!,
    }) as Agent<unknown>,
    testRunJob({ workspacesDir: cfg.WORKSPACES_DIR! }),
    e2eJob({ workspacesDir: cfg.WORKSPACES_DIR! }),
    // BUILD_WORKERS OpenCode workers (build-1, build-2), and one merge loop, so merges never share
    // the repository's main checkout.
    ...Array.from({ length: cfg.BUILD_WORKERS! }, (_, i) =>
      buildWorker({
        n: i + 1,
        bin,
        workspacesDir: cfg.WORKSPACES_DIR!,
        gatewayUrl: cfg.GATEWAY_URL!,
        hookToken: cfg.AM_HOOK_TOKEN!,
        fallbackModel: cfg.OPENROUTER_BUILD_MODEL!,
        heartbeatMs: cfg.HEARTBEAT_MS!,
      }),
    ),
    mergeJob({ workspacesDir: cfg.WORKSPACES_DIR! }),
  ];
  for (const agent of agents) {
    runLoop(agent, deps).catch((e: unknown) => {
      console.error(
        `runner: ${agent.id} loop stopped: ${e instanceof Error ? e.message : "error"}`,
      );
    });
  }
  console.log(
    `runner started (gateway ${cfg.GATEWAY_URL}, ${agents.length} loops, ${cfg.BUILD_WORKERS} build workers)`,
  );
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
