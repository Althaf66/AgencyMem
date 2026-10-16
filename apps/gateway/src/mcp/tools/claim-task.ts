import type { ToolInput, ToolOutput } from "@agencymem/contracts";
import { readQuery } from "@agencymem/graph";
import { claimTask } from "@agencymem/memory";
import { deps, leaseHeld } from "../guards";
import {
  agentOf,
  findOwn,
  guardFail,
  invalid,
  memoryCtx,
  ok,
  type Outcome,
  type ToolCtx,
} from "./common";

type ClaimState = {
  key: string;
  column: string;
  attempts: number;
  leaseOwner: string | null;
  leaseUntil: number | null;
  openKeys: string[];
};

/**
 * claim_task (contracts.md section 7, C1). Guards: deps, then lease. Takes the first free build
 * card by order (or the named card), starts a lease and moves it to In progress. Only build
 * workers claim cards.
 */
export async function claimTaskTool(
  ctx: ToolCtx,
  input: ToolInput<"claim_task">,
): Promise<Outcome<ToolOutput<"claim_task">>> {
  const { agent, workerId } = agentOf(ctx);
  if (agent !== "build") return invalid(`Only build claims cards; this session is ${agent}.`);
  if (input.taskId) {
    const own = await findOwn(ctx, input.taskId, "Task");
    if (!own.ok) return own;
  }

  const now = ctx.now();
  const claimed = await claimTask(memoryCtx(ctx), {
    taskId: input.taskId,
    workerId,
    now,
    leaseMs: ctx.leaseMs,
  });
  if (!claimed) {
    if (!input.taskId) return ok({ task: null }); // no free card is not an error
    return refuse(ctx, input.taskId, now);
  }

  const { task, from } = claimed;
  ctx.events.emit(ctx.binding.projectId, "lease.changed", {
    itemId: task.id,
    owner: task.leaseOwner,
    until: task.leaseUntil,
    reason: "claim",
  });
  if (from !== task.column) {
    ctx.events.emit(ctx.binding.projectId, "task.moved", {
      taskId: task.id,
      key: task.key,
      from,
      to: task.column,
      version: task.version,
    });
  }
  return ok({
    task: {
      id: task.id,
      key: task.key,
      title: task.title,
      version: task.version,
      column: task.column,
      lane: task.lane,
      kind: task.kind,
      attempts: task.attempts,
      branch: `card/${task.key}`,
    },
  });
}

/**
 * Why the named card was not claimed. A card no worker could take now (not Ready, or Blocked) is
 * VALIDATION_FAILED and not counted; open dependencies (deps) or a live lease (lease) are rejected
 * claims.
 */
async function refuse(ctx: ToolCtx, taskId: string, now: number) {
  const [state] = await readQuery<ClaimState>(ctx.db, ctx.binding.graph, "read/task-claim", {
    projectId: ctx.binding.projectId,
    taskId,
  });
  if (!state || !["Ready", "In progress", "Testing"].includes(state.column)) {
    return invalid(`${state?.key ?? taskId} is in ${state?.column ?? "no column"}, not Ready.`);
  }
  if (state.attempts >= 2)
    return invalid(`${state.key} is Blocked after ${state.attempts} attempts.`);
  const open = deps(state.openKeys);
  if (open) return guardFail(ctx, open);
  if (state.leaseUntil !== null && state.leaseUntil >= now) {
    return guardFail(ctx, leaseHeld({ owner: state.leaseOwner, until: state.leaseUntil }));
  }
  // ponytail: this read runs after the failed claim, not in its query; a lease that ends between
  // the two answers this instead of LEASE_HELD. Nothing is written wrongly, and the next claim wins.
  return invalid(`${state.key} is in ${state.column} with no lease to take over.`);
}
