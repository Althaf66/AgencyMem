// Gate decisions that write more than the gate: G5 records the Deployment (T23); a G6 rejection
// ends its Defect and notes its card (T27).
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

/**
 * T27: rejects a waiting G6 at `version` in one query: its Defect becomes wont_fix and the fix
 * card gets "Fix rejected: <reason>" as its note. Null when the gate changed.
 */
export async function rejectFix(
  ctx: Ctx,
  input: { gateId: string; version: number; reason: string; actor: Actor; now: number },
): Promise<{
  gate: Gate;
  taskId: string;
  key: string;
  taskVersion: number;
  defect: { id: string; version: number } | null;
} | null> {
  const reason = text(300).parse(input.reason);
  const rows = await writeQuery<{
    g: { properties: Record<string, unknown> };
    taskId: string;
    key: string;
    taskVersion: number;
    defectId: string | null;
    defectVersion: number | null;
  }>(ctx.db, ctx.graph, "write/reject-fix", {
    projectId: ctx.projectId,
    gateId: input.gateId,
    version: input.version,
    reason,
    note: `Fix rejected: ${reason}`.slice(0, 500), // Task.note is at most 500
    actor: input.actor,
    now: input.now,
  });
  const row = rows[0];
  if (!row) return null;
  const { taskId, key, taskVersion, defectId, defectVersion } = row;
  return {
    gate: Gate.parse(row.g.properties),
    taskId,
    key,
    taskVersion,
    defect: defectId ? { id: defectId, version: defectVersion! } : null,
  };
}
