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

/** The text of one loaded query. Not exported from the package: callers run queries by name. */
export function queryText(name: string): string {
  const cypher = queries.get(name);
  if (cypher === undefined) throw new Error(`Unknown query ${name}`);
  return cypher;
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
  const cypher = queryText(name);
  try {
    const reply = await db.selectGraph(graph).roQuery<T>(cypher, { params });
    return reply.data ?? [];
  } catch (e) {
    // A graph that was never written does not exist yet; it holds no nodes, so no rows.
    if (e instanceof Error && e.message.includes("empty key")) return [];
    throw e;
  }
}

export type ReadOnlyResult = {
  columns: string[];
  rows: unknown[][];
  ms: number;
  truncated: boolean;
};

/**
 * Runs a person's read query (read_query, POST /api/query) with GRAPH.RO_QUERY, so FalkorDB itself
 * refuses any write, a timeout, and at most `maxRows` rows. The read-only guard has already checked
 * the text. Columns come from the first row, so a query with no rows reports no columns.
 */
export async function runReadOnly(
  db: FalkorDB,
  graph: string,
  cypher: string,
  params: Params,
  limits: { timeoutMs: number; maxRows: number },
): Promise<ReadOnlyResult> {
  const started = performance.now();
  let data: Record<string, unknown>[];
  try {
    const reply = await db
      .selectGraph(graph)
      .roQuery<Record<string, unknown>>(cypher, { params, TIMEOUT: limits.timeoutMs });
    data = reply.data ?? [];
  } catch (e) {
    if (!(e instanceof Error && e.message.includes("empty key"))) throw e;
    data = []; // a graph that was never written holds no rows
  }
  const columns = data[0] ? Object.keys(data[0]) : [];
  return {
    columns,
    rows: data.slice(0, limits.maxRows).map((row) => columns.map((c) => row[c])),
    ms: Math.round(performance.now() - started),
    truncated: data.length > limits.maxRows,
  };
}
