import type { ToolInput, ToolOutput, WorkItemKind } from "@agencymem/contracts";
import { readQuery } from "@agencymem/graph";
import { flagImpact, supersedeFacts } from "@agencymem/memory";
import { ownership, source } from "../guards";
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

/**
 * record_change_request (contracts.md section 7). Guards: ownership, source (each old fact is a
 * current Fact of the project). Write 1 supersedes the facts and sets the CR status; write 2 flags
 * what the old facts touch: Tasks to Rework (a held lease is cancelled, C5), DocSections stale.
 * ponytail: two writes, as the contract says. If write 2 fails after write 1, a retry finds the CR
 * applied and is refused; the startup repair does not redo the flag.
 */
export async function recordChangeRequestTool(
  ctx: ToolCtx,
  input: ToolInput<"record_change_request">,
): Promise<Outcome<ToolOutput<"record_change_request">>> {
  const { agent } = agentOf(ctx);
  const found = await findOwn(ctx, input.itemId, "WorkItem");
  if (!found.ok) return found;
  const refused = ownership({ kind: "agent", agent }, "record_change_request", {
    itemKind: found.output.kind as WorkItemKind,
  });
  if (refused) return guardFail(ctx, refused);

  if (found.output.subjectId !== input.crId) {
    return invalid(`Change request ${input.crId} is not the subject of item ${input.itemId}.`);
  }
  const cr = await findOwn(ctx, input.crId, "ChangeRequest");
  if (!cr.ok) return cr;
  if (cr.output.status !== "open") {
    return invalid(`Change request ${input.crId} is already ${String(cr.output.status)}.`);
  }
  const oldIds = input.changes.map((c) => c.oldFactId);
  if (new Set(oldIds).size !== oldIds.length) return invalid("A fact is changed twice.");

  const { graph, projectId } = ctx.binding;
  const current = await readQuery<{ id: string }>(ctx.db, graph, "read/current-facts", {
    projectId,
  });
  const missing = source(
    oldIds.map((id) => ({ ids: [id] })),
    new Set(current.map((f) => f.id)),
  );
  if (missing) return guardFail(ctx, missing);

  const crStatus = input.changes.length ? "applied" : (input.outcome ?? "no_change");
  const now = ctx.now();
  const memory = memoryCtx(ctx);
  const written = await supersedeFacts(memory, {
    crId: input.crId,
    status: crStatus,
    changes: input.changes,
    createdBy: agent,
    now,
  });
  if (!written.applied) {
    return invalid("The change request or one of its facts changed meanwhile; read again.");
  }
  const flagged = await flagImpact(memory, { crId: input.crId, factIds: oldIds });

  oldIds.forEach((factId, i) => {
    ctx.events.emit(projectId, "node.ended", {
      factId,
      validTo: now,
      replacedBy: written.newFactIds[i]!,
    });
  });
  if (written.newFactIds.length) {
    ctx.events.emit(projectId, "node.written", {
      label: "Fact",
      id: written.newFactIds[0]!,
      version: 1,
      summary: `${written.newFactIds.length} facts from a change request`,
      ids: written.newFactIds,
    });
  }
  const tasks = flagged.filter((f) => f.label === "Task");
  const sections = flagged.filter((f) => f.label === "DocSection");
  for (const t of tasks) {
    if (t.from === "Rework") continue; // flagged again, not moved
    ctx.events.emit(projectId, "task.moved", {
      taskId: t.id,
      key: t.key,
      from: t.from,
      to: "Rework",
      version: t.version,
      reason: "Change request",
    });
  }
  for (const s of sections) {
    ctx.events.emit(projectId, "doc.stale", { docSectionId: s.id, crId: input.crId });
  }
  for (const t of tasks) {
    if (!t.owner || t.from === "Rework") continue; // the flag cleared no lease on a Rework card
    ctx.events.emit(projectId, "lease.changed", {
      itemId: t.id,
      owner: null,
      until: null,
      reason: "cancel",
    });
  }
  return ok({
    newFactIds: written.newFactIds,
    flagged: { taskIds: tasks.map((t) => t.id), docSectionIds: sections.map((s) => s.id) },
    crStatus,
  });
}
