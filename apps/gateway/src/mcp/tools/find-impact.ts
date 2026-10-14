import type { ToolInput, ToolOutput } from "@agencymem/contracts";
import { readQuery } from "@agencymem/graph";
import { findOwn, ok, type Outcome, type ToolCtx } from "./common";

/** find_impact (contracts.md section 7). Guard: tenancy. Runs impact.cypher and changes nothing. */
export async function findImpactTool(
  ctx: ToolCtx,
  input: ToolInput<"find_impact">,
): Promise<Outcome<ToolOutput<"find_impact">>> {
  const fact = await findOwn(ctx, input.factId, "Fact");
  if (!fact.ok) return fact;
  const rows = await readQuery<{ type: string; id: string; label: string | null }>(
    ctx.db,
    ctx.binding.graph,
    "read/impact",
    { factId: input.factId },
  );
  return ok({ nodes: rows.map((r) => ({ type: r.type, id: r.id, label: r.label ?? r.id })) });
}
