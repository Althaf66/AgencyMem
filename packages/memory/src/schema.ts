import type { FalkorDB } from "@agencymem/graph";
import { runSchema } from "@agencymem/graph/write";

export type SchemaName = "registry" | "client" | "agency";

/** Creates the indexes of one graph from `cypher/schema/<schema>.cypher`. Safe to run again. */
export function applySchema(db: FalkorDB, graph: string, schema: SchemaName): Promise<void> {
  return runSchema(db, graph, `schema/${schema}`);
}
