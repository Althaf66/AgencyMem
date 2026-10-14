import type { ToolInput, ToolOutput } from "@agencymem/contracts";
import { complete } from "@agencymem/memory";
import { lease, reject } from "../guards";
import {
  agentOf,
  fail,
  findOwn,
  guardFail,
  memoryCtx,
  num,
  ok,
  readNode,
  str,
  type Outcome,
  type ToolCtx,
} from "./common";

/**
 * complete_item (contracts.md section 7). Guard: lease. done or failed, with one Run per `runs`
 * entry. The stage machine that opens the next items arrives in Phase 2, so `opened` is empty.
 */
export async function completeItemTool(
  ctx: ToolCtx,
  input: ToolInput<"complete_item">,
): Promise<Outcome<ToolOutput<"complete_item">>> {
  const { agent, workerId } = agentOf(ctx);
  if (input.result) {
    return fail({
      code: "INTERNAL",
      reason: "complete_item with a merge result is not built yet (task 4.11).",
    });
  }
  const found = await findOwn(ctx, input.itemId, "WorkItem");
  if (!found.ok) return found;

  const now = ctx.now();
  const held = { owner: str(found.output.leaseOwner), until: num(found.output.leaseUntil) };
  const refused = lease(held, workerId, now);
  if (refused) return guardFail(ctx, refused);

  const item = await complete(memoryCtx(ctx), {
    itemId: input.itemId,
    workerId,
    agent,
    outcome: input.outcome,
    note: input.note,
    runs: input.runs,
    now,
  });
  if (!item) {
    // The lease changed between the guard and the write; the write checked it again and refused.
    const current = await readNode(ctx, input.itemId);
    const why =
      lease(
        { owner: str(current?.props.leaseOwner), until: num(current?.props.leaseUntil) },
        workerId,
        now,
      ) ?? reject("lease", "LEASE_ENDED", "Your lease has ended; stop work on this item.");
    return guardFail(ctx, why);
  }

  const projectId = ctx.binding.projectId;
  ctx.events.emit(projectId, "lease.changed", {
    itemId: item.id,
    owner: null,
    until: null,
    reason: "release",
  });
  ctx.events.emit(projectId, "node.written", {
    label: "WorkItem",
    id: item.id,
    version: item.version,
    summary: `${item.kind} item ${item.status}`,
  });
  return ok({ item: { id: item.id, status: item.status, attempts: item.attempts }, opened: [] });
}
