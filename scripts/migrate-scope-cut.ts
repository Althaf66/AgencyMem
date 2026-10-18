// `pnpm migrate:scope-cut`: the one-time migration for the removal of G5 and the maintenance phase
// (packages/memory/src/migrate.ts). Safe to run again; stop the gateway and runner first.
import { ConfigSchema } from "@agencymem/contracts";
import { close, connect } from "@agencymem/graph";
import { migrateScopeCut } from "@agencymem/memory";

const url = ConfigSchema.shape.FALKORDB_URL.parse(process.env.FALKORDB_URL);
try {
  const db = await connect(url);
  const { projects, removed, reports } = await migrateScopeCut(db);
  console.log(
    `migrate:scope-cut: ${projects} projects back to launch, ${removed} nodes removed, ${reports} readiness reports cleaned`,
  );
} catch (e) {
  console.error(`migrate:scope-cut: ${e instanceof Error ? e.message || e.name : String(e)}`);
  process.exitCode = 1;
} finally {
  await close();
}
