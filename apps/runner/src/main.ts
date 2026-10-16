// The runner: one loop per model agent, each working on every open project through the gateway.
import { loadConfig } from "@agencymem/contracts";
import { createChat, createModelClient } from "@agencymem/llm";
import type { Agent } from "./agent";
import { AGENTS } from "./agents";
import { writeTestsAgent } from "./agents/test/write-tests";
import { runLoop } from "./loop";
import { assertWorkspacesOutside } from "./opencode-config";

try {
  const cfg = loadConfig(process.env, "runner");
  assertWorkspacesOutside(cfg.WORKSPACES_DIR!);
  const llm = createModelClient({ chat: createChat(cfg) });
  const deps = {
    gatewayUrl: cfg.GATEWAY_URL!,
    token: cfg.AM_AGENT_TOKEN!,
    llm,
    heartbeatMs: cfg.HEARTBEAT_MS!,
  };
  // The Test agent works in the project repositories under WORKSPACES_DIR.
  const agents: Agent<unknown>[] = [
    ...AGENTS,
    writeTestsAgent({
      workspacesDir: cfg.WORKSPACES_DIR!,
      gatewayUrl: cfg.GATEWAY_URL!,
      hookToken: cfg.AM_HOOK_TOKEN!,
    }) as Agent<unknown>,
  ];
  for (const agent of agents) {
    runLoop(agent, deps).catch((e: unknown) => {
      console.error(
        `runner: ${agent.id} loop stopped: ${e instanceof Error ? e.message : "error"}`,
      );
    });
  }
  console.log(
    `runner started (gateway ${cfg.GATEWAY_URL}, ${agents.length} agents, ${cfg.BUILD_WORKERS} build worker)`,
  );
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
