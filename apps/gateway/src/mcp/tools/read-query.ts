import type { ToolInput, ToolOutput } from "@agencymem/contracts";
import { AGENCY_GRAPH, runReadOnly, type FalkorDB, type ReadOnlyResult } from "@agencymem/graph";
import { readOnly } from "../guards";
import { guardFail, invalid, ok, type Outcome, type ToolCtx } from "./common";

/** contracts.md section 7, read_query: a 2,000 ms timeout and at most 500 rows. */
export const READ_QUERY_LIMITS = { timeoutMs: 2000, maxRows: 500 };

/**
 * Runs a read query that passed the read-only guard, for read_query and POST /api/query.
 * `client` is the caller's client graph. A query FalkorDB refuses (bad syntax, a timeout, a write
 * it caught) is VALIDATION_FAILED.
 */
export async function runReadQuery(
  db: FalkorDB,
  clientGraph: string,
  input: ToolInput<"read_query">,
): Promise<Outcome<ReadOnlyResult>> {
  const graph = input.graph === "agency" ? AGENCY_GRAPH : clientGraph;
  try {
    return ok(await runReadOnly(db, graph, input.cypher, input.params ?? {}, READ_QUERY_LIMITS));
  } catch (e) {
    return invalid(`The query failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** read_query (contracts.md section 7). Guard: read-only (UI session only, no write clause). */
export async function readQueryTool(
  ctx: ToolCtx,
  input: ToolInput<"read_query">,
): Promise<Outcome<ToolOutput<"read_query">>> {
  const refused = readOnly(input.cypher, ctx.binding.kind);
  if (refused) return guardFail(ctx, refused);
  return runReadQuery(ctx.db, ctx.binding.graph, input);
}
