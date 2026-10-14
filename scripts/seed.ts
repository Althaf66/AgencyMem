// `pnpm seed`: creates the registry and agency graphs with their indexes. Safe to run again.
// Client graphs get their schema when a project is created (task 1.10).
import { pathToFileURL } from "node:url";
import { ConfigSchema } from "@agencymem/contracts";
import { AGENCY_GRAPH, REGISTRY_GRAPH, close, connect, type FalkorDB } from "@agencymem/graph";
import { applySchema } from "@agencymem/memory";

export async function seed(db: FalkorDB): Promise<void> {
  await applySchema(db, REGISTRY_GRAPH, "registry");
  await applySchema(db, AGENCY_GRAPH, "agency");
}

async function main(): Promise<void> {
  const url = ConfigSchema.shape.FALKORDB_URL.parse(process.env.FALKORDB_URL);
  let db: FalkorDB;
  try {
    db = await connect(url);
  } catch (e) {
    // Host and port only: a Redis URL can carry a password (AGENTS.md rule 10).
    console.error(`seed: FalkorDB is not reachable at ${new URL(url).host}.`);
    console.error("seed: run `docker compose up -d`, or set FALKORDB_URL.");
    throw e;
  }
  try {
    await seed(db);
    console.log(`seed: ${REGISTRY_GRAPH} and ${AGENCY_GRAPH} graphs are ready`);
  } finally {
    await close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e: unknown) => {
    console.error(`seed: ${e instanceof Error ? e.message || e.name : String(e)}`);
    process.exitCode = 1;
  });
}
