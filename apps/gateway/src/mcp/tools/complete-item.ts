import type { ToolInput, ToolOutput } from "@agencymem/contracts";
import { complete, completeMerge } from "@agencymem/memory";
import { lease, reject } from "../guards";
import { runStage } from "../../stage/effects";
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
 * complete_item (contracts.md section 7). Guard: lease. done or failed, with one Run per `runs`
 * entry. Then the stage machine runs (stage-machine.md section 1, rule 1) and `opened` lists the
 * items it opened. A merge item ends only with its `result` (C6): done with `mergedSha`, or failed
 * with `conflictFiles`; a failed merge with no result is an ordinary failure (git itself failed).
 */
export async function completeItemTool(
  ctx: ToolCtx,
  input: ToolInput<"complete_item">,
): Promise<Outcome<ToolOutput<"complete_item">>> {
  const { agent, workerId } = agentOf(ctx);
  const found = await findOwn(ctx, input.itemId, "WorkItem");
  if (!found.ok) return found;
  const { mergedSha, conflictFiles } = input.result ?? {};
  const isMerge = found.output.kind === "merge";
  if (input.result && !isMerge) return invalid("result is for merge items only.");
  if (isMerge && input.outcome === "done" && (!mergedSha || conflictFiles))
    return invalid("A merge item is done only with result.mergedSha.");
  if (input.outcome === "failed" && (mergedSha || (conflictFiles && !conflictFiles.length)))
    return invalid("A failed merge gives result.conflictFiles (one file or more) only.");

  const now = ctx.now();
  const held = { owner: str(found.output.leaseOwner), until: num(found.output.leaseUntil) };
  const refused = lease(held, workerId, now);
  if (refused) return guardFail(ctx, refused);

  if (isMerge && (mergedSha || conflictFiles)) {
    return completeMergeItem(
      ctx,
      input,
      mergedSha ? { mergedSha } : { conflictFiles: conflictFiles! },
    );
  }
  const item = await complete(memoryCtx(ctx), {
    itemId: input.itemId,
    workerId,
    agent,
    outcome: input.outcome,
    note: input.note,
    summary: input.summary,
    runs: input.runs,
    now,
  });
  if (!item) return leaseGone(ctx, input.itemId, workerId, now);

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
  const opened = await runStage(ctx.db, ctx.events, projectId, {
    type: "item_completed",
    kind: item.kind,
    outcome: input.outcome,
    actor: agent,
    subjectId: item.subjectId,
  });
  return ok({ item: { id: item.id, status: item.status, attempts: item.attempts }, opened });
}

/** The lease changed between the guard and the write; the write checked it again and refused. */
async function leaseGone(ctx: ToolCtx, itemId: string, workerId: string, now: number) {
  const current = await readNode(ctx, itemId);
  const why =
    lease(
      { owner: str(current?.props.leaseOwner), until: num(current?.props.leaseUntil) },
      workerId,
      now,
    ) ?? reject("lease", "LEASE_ENDED", "Your lease has ended; stop work on this item.");
  return guardFail(ctx, why);
}

/** A merge item with its result: one write for the item and its card (contracts.md C6). */
async function completeMergeItem(
  ctx: ToolCtx,
  input: ToolInput<"complete_item">,
  result: { mergedSha: string } | { conflictFiles: string[] },
): Promise<Outcome<ToolOutput<"complete_item">>> {
  const { agent, workerId } = agentOf(ctx);
  const now = ctx.now();
  const done = await completeMerge(memoryCtx(ctx), {
    itemId: input.itemId,
    workerId,
    agent,
    result,
    note: input.note,
    summary: input.summary,
    runs: input.runs,
    now,
  });
  if (!done) return leaseGone(ctx, input.itemId, workerId, now);

  const { item } = done;
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
  const taskId = item.subjectId!; // complete-merge.cypher matched the card through it
  if (done.from !== done.to) {
    ctx.events.emit(projectId, "task.moved", {
      taskId,
      key: done.key,
      from: done.from,
      to: done.to,
      version: done.taskVersion,
      ...("conflictFiles" in result
        ? { reason: `Merge conflict: ${result.conflictFiles.join(", ")}`.slice(0, 200) }
        : {}),
    });
  } else {
    ctx.events.emit(projectId, "task.edited", {
      taskId,
      fields: "mergedSha" in result ? ["mergedSha"] : ["mergedSha", "note"],
      version: done.taskVersion,
      actor: agent,
    });
  }
  const opened = await runStage(ctx.db, ctx.events, projectId, {
    type: "item_completed",
    kind: item.kind,
    outcome: input.outcome,
    actor: agent,
    subjectId: item.subjectId,
  });
  return ok({ item: { id: item.id, status: item.status, attempts: item.attempts }, opened });
}
