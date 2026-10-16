// Gate decisions that write more than the gate: G5 records the Deployment (T23).
import { Gate, text, type Actor } from "@agencymem/contracts";
import { writeQuery } from "@agencymem/graph/write";
import { ulid } from "ulid";
import type { Ctx } from "./ctx";

/**
 * Approves a waiting G5 at `version` and writes the Deployment in the same query. `override` marks
 * an approval of a failed readiness report, with `reason`. Null when the gate changed.
 */
export async function approveDeploy(
  ctx: Ctx,
  input: {
    gateId: string;
    version: number;
    environment: string;
    override: boolean;
    reason: string | null;
    actor: Actor;
    now: number;
  },
): Promise<{ gate: Gate; deploymentId: string } | null> {
  const rows = await writeQuery<{
    g: { properties: Record<string, unknown> };
    deploymentId: string;
  }>(ctx.db, ctx.graph, "write/approve-deploy", {
    projectId: ctx.projectId,
    gateId: input.gateId,
    version: input.version,
    environment: text(40).parse(input.environment),
    override: input.override,
    reason: input.reason,
    actor: input.actor,
    now: input.now,
    deploymentId: ulid(),
  });
  const row = rows[0];
  return row ? { gate: Gate.parse(row.g.properties), deploymentId: row.deploymentId } : null;
}
