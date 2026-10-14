import type { ToolInput, ToolOutput } from "@agencymem/contracts";
import { renew } from "@agencymem/memory";
import { lease, reject } from "../guards";
import { agentOf, findOwn, guardFail, memoryCtx, ok, type Outcome, type ToolCtx } from "./common";

/**
 * heartbeat (contracts.md section 7). Guard: lease. The renewal checks the lease inside its one
 * query; when it refuses, the lease guard names why and the caller must stop work at once.
 */
export async function heartbeatTool(
  ctx: ToolCtx,
  input: ToolInput<"heartbeat">,
): Promise<Outcome<ToolOutput<"heartbeat">>> {
  const { workerId } = agentOf(ctx);
  // A missing id is NOT_FOUND and another project's is FOREIGN_NODE, not a counted lease rejection.
  const own = await findOwn(ctx, input.itemId, ["WorkItem", "Task"]);
  if (!own.ok) return own;
  const now = ctx.now();
  const renewed = await renew(memoryCtx(ctx), {
    id: input.itemId,
    workerId,
    now,
    leaseMs: ctx.leaseMs,
  });
  if (!renewed.ok) {
    const why =
      lease({ owner: renewed.owner, until: renewed.until }, workerId, now) ??
      reject("lease", "LEASE_ENDED", "Your lease has ended; stop work on this item.");
    return guardFail(ctx, why);
  }
  ctx.events.emit(ctx.binding.projectId, "lease.changed", {
    itemId: input.itemId,
    owner: workerId,
    until: renewed.leaseUntil,
    reason: "renew",
  });
  return ok({ leaseUntil: renewed.leaseUntil });
}
