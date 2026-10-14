import type { ToolInput, ToolOutput } from "@agencymem/contracts";
import { AGENCY_GRAPH, runReadOnly } from "@agencymem/graph";
import { readOnly } from "../guards";
import { guardFail, invalid, ok, type Outcome, type ToolCtx } from "./common";

/** contracts.md section 7, read_query: a 2,000 ms timeout and at most 500 rows. */
export const READ_QUERY_LIMITS = { timeoutMs: 2000, maxRows: 500 };

/**
 * read_query (contracts.md section 7). Guard: read-only. `client` is the session's client graph.
 * A query FalkorDB refuses (bad syntax, a timeout, a write it caught) is VALIDATION_FAILED.
 */
export async function readQueryTool(
  ctx: ToolCtx,
  input: ToolInput<"read_query">,
): Promise<Outcome<ToolOutput<"read_query">>> {
  const refused = readOnly(input.cypher, ctx.binding.kind);
  if (refused) return guardFail(ctx, refused);
  const graph = input.graph === "agency" ? AGENCY_GRAPH : ctx.binding.graph;
  try {
    return ok(
      await runReadOnly(ctx.db, graph, input.cypher, input.params ?? {}, READ_QUERY_LIMITS),
    );
  } catch (e) {
    return invalid(`The query failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
