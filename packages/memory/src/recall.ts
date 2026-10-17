import type { AgentId } from "@agencymem/contracts";
import { writeQuery } from "@agencymem/graph/write";
import type { Ctx } from "./ctx";

/** Records what an item read: a RECALLED edge to each node named by id or key. Returns their ids. */
export async function recordRecall(
  ctx: Ctx,
  input: { itemId: string; agent: AgentId; ids: string[]; keys: string[]; now: number },
): Promise<string[]> {
  const [row] = await writeQuery<{ ids: string[] }>(ctx.db, ctx.graph, "write/record-recall", {
    projectId: ctx.projectId,
    itemId: input.itemId,
    agent: input.agent,
    ids: input.ids,
    keys: input.keys,
    at: input.now,
  });
  return row?.ids ?? [];
}
