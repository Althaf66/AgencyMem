// The write entry of packages/graph. Only packages/memory may import it (AGENTS.md rule 3,
// enforced by .dependency-cruiser.cjs).
import type { FalkorDB } from "falkordb";
import { queryText, type Params } from "./queries";

/** Runs one `write/` query: one query per write, so FalkorDB applies it as one unit. */
export async function writeQuery<T>(
  db: FalkorDB,
  graph: string,
  name: string,
  params: Params,
): Promise<T[]> {
  if (!name.startsWith("write/")) throw new Error(`${name}: not a write/ query`);
  const reply = await db.selectGraph(graph).query<T>(queryText(name), { params });
  return reply.data ?? [];
}

/**
 * Runs each `;`-separated statement of a `schema/` file. FalkorDB has no CREATE INDEX IF NOT
 * EXISTS, so an index that already exists is skipped; running a schema twice is safe.
 */
export async function runSchema(db: FalkorDB, graph: string, name: string): Promise<void> {
  if (!name.startsWith("schema/")) throw new Error(`${name}: not a schema/ file`);
  const statements = queryText(name)
    .replace(/^\s*\/\/.*$/gm, "") // drop comment lines first, so a ";" in a comment is harmless
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) {
    try {
      await db.selectGraph(graph).query(statement);
    } catch (e) {
      if (!(e instanceof Error && e.message.includes("already indexed"))) throw e;
    }
  }
}
