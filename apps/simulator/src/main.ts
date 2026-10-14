import { loadConfig } from "@agencymem/contracts";

try {
  const cfg = loadConfig(process.env, "simulator");
  console.log(`simulator started (seed ${cfg.SIM_SEED}, gateway ${cfg.GATEWAY_URL})`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
