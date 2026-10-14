// The .cypher loader. Every query lives in packages/graph/cypher/**; no TypeScript file holds one.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FalkorDB } from "falkordb";

type Param = null | string | number | boolean | Param[] | { [key: string]: Param };
export type Params = Record<string, Param>;

const ROOT = fileURLToPath(new URL("../cypher", import.meta.url));

/** Every .cypher file, keyed by its path without the extension, for example `read/project-graph`. */
const queries = new Map(
  readdirSync(ROOT, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".cypher"))
    .map((file) => [
      file.replaceAll("\\", "/").replace(/\.cypher$/, ""),
      readFileSync(join(ROOT, file), "utf8"),
    ]),
);

export function listQueries(): string[] {
  return [...queries.keys()].sort();
}

/** Runs a `read/` query with GRAPH.RO_QUERY, so FalkorDB itself refuses any write. */
export async function readQuery<T>(
  db: FalkorDB,
  graph: string,
  name: string,
  params: Params,
): Promise<T[]> {
  if (!name.startsWith("read/")) {
    throw new Error(`${name}: only read/ queries run on the read path`);
  }
  const cypher = queries.get(name);
  if (cypher === undefined) throw new Error(`Unknown query ${name}`);
  try {
    const reply = await db.selectGraph(graph).roQuery<T>(cypher, { params });
    return reply.data ?? [];
  } catch (e) {
    // A graph that was never written does not exist yet; it holds no nodes, so no rows.
    if (e instanceof Error && e.message.includes("empty key")) return [];
    throw e;
  }
}
