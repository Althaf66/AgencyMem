import { loadConfig } from "@agencymem/contracts";

try {
  const cfg = loadConfig(process.env, "runner");
  console.log(`runner started (gateway ${cfg.GATEWAY_URL}, ${cfg.BUILD_WORKERS} build worker)`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
