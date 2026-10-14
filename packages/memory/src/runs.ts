import type { AgentId, RunInput } from "@agencymem/contracts";
import { ulid } from "ulid";

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
