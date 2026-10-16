import type { AgentId, RunInput } from "@agencymem/contracts";
import { writeQuery } from "@agencymem/graph/write";
import { ulid } from "ulid";
import type { Ctx } from "./ctx";

/** The property rows of the Run nodes for one item: one per model call or build step. */
export function runRows(
  runs: RunInput[],
  at: { projectId: string; itemId: string; agent: AgentId; now: number },
) {
  return runs.map((run) => ({
    ...run,
    id: ulid(),
    projectId: at.projectId,
    itemId: at.itemId,
    agent: at.agent,
    createdBy: at.agent,
    createdAt: at.now,
    version: 1,
  }));
}

/** Writes one Run node for an item: a build run's final step (route 30). Returns its id. */
export async function writeRun(
  ctx: Ctx,
  input: { itemId: string; agent: AgentId; run: RunInput; now: number },
): Promise<string> {
  const run = runRows([input.run], { projectId: ctx.projectId, ...input })[0]!;
  await writeQuery(ctx.db, ctx.graph, "write/write-run", { run });
  return run.id;
}
