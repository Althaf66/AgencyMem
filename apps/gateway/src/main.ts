import { loadConfig } from "@agencymem/contracts";

try {
  const cfg = loadConfig(process.env, "gateway");
  console.log(`gateway started (port ${cfg.AM_PORT})`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
