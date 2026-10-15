// The runner: one loop per model agent, each working on every open project through the gateway.
import { loadConfig } from "@agencymem/contracts";
import { createChat, createModelClient } from "@agencymem/llm";
import { AGENTS } from "./agents";
import { runLoop } from "./loop";

try {
  const cfg = loadConfig(process.env, "runner");
  const llm = createModelClient({ chat: createChat(cfg) });
  const deps = {
    gatewayUrl: cfg.GATEWAY_URL!,
    token: cfg.AM_AGENT_TOKEN!,
    llm,
    heartbeatMs: cfg.HEARTBEAT_MS!,
  };
  for (const agent of AGENTS) {
    runLoop(agent, deps).catch((e: unknown) => {
      console.error(
        `runner: ${agent.id} loop stopped: ${e instanceof Error ? e.message : "error"}`,
      );
    });
  }
  console.log(
    `runner started (gateway ${cfg.GATEWAY_URL}, ${AGENTS.length} agents, ${cfg.BUILD_WORKERS} build worker)`,
  );
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
