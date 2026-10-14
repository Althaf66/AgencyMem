import type { ToolInput, ToolOutput } from "@agencymem/contracts";
import { claimItem } from "@agencymem/memory";
import { CLAIMS, leaseHeld } from "../guards";
import {
  agentOf,
  findOwn,
  guardFail,
  invalid,
  memoryCtx,
  num,
  ok,
  readNode,
  str,
  type Outcome,
  type ToolCtx,
} from "./common";

/**
 * claim_item (contracts.md section 7). Guard: tenancy. Takes the oldest open item of the given
 * kinds (default: every kind the agent claims), or the named item, and starts a lease.
 */
export async function claimItemTool(
  ctx: ToolCtx,
  input: ToolInput<"claim_item">,
): Promise<Outcome<ToolOutput<"claim_item">>> {
  const { agent, workerId } = agentOf(ctx);
  const claimable = CLAIMS[agent];
  const kinds = input.kinds ?? claimable;
  const notOurs = kinds.filter((kind) => !claimable.includes(kind));
  if (notOurs.length > 0) return invalid(`${agent} does not claim ${notOurs.join(", ")} items.`);

  if (input.itemId) {
    const own = await findOwn(ctx, input.itemId, "WorkItem");
    if (!own.ok) return own;
    // Only a held item is LEASE_HELD; an item of another kind, or one no longer open, is invalid.
    const kind = str(own.output.kind);
    if (!kind || !(kinds as string[]).includes(kind)) {
      return invalid(
        `Item ${input.itemId} is a ${kind} item; ${agent} claims ${kinds.join(", ")}.`,
      );
    }
    const status = str(own.output.status);
    if (status !== "open" && status !== "claimed") {
      return invalid(`Item ${input.itemId} is ${status}, not open.`);
    }
  }

  const item = await claimItem(memoryCtx(ctx), {
    kinds,
    itemId: input.itemId,
    workerId,
    now: ctx.now(),
    leaseMs: ctx.leaseMs,
  });
  if (!item) {
    if (!input.itemId) return ok({ item: null }); // no work is not an error
    const current = await readNode(ctx, input.itemId);
    return guardFail(
      ctx,
      leaseHeld({ owner: str(current?.props.leaseOwner), until: num(current?.props.leaseUntil) }),
    );
  }

  ctx.events.emit(ctx.binding.projectId, "lease.changed", {
    itemId: item.id,
    owner: item.leaseOwner,
    until: item.leaseUntil,
    reason: "claim",
  });
  return ok({ item });
}
