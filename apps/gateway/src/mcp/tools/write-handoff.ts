import type { ToolInput, ToolOutput, WorkItemKind } from "@agencymem/contracts";
import { writeHandoff } from "@agencymem/memory";
import { ownership } from "../guards";
import {
  agentOf,
  findOwn,
  guardFail,
  memoryCtx,
  notFound,
  ok,
  type Outcome,
  type ToolCtx,
} from "./common";

/**
 * write_handoff (contracts.md section 7). Guard: ownership. The item's kind must be one the agent
 * claims, and only launch may send a readiness report (C8).
 */
export async function writeHandoffTool(
  ctx: ToolCtx,
  input: ToolInput<"write_handoff">,
): Promise<Outcome<ToolOutput<"write_handoff">>> {
  const { agent } = agentOf(ctx);
  const found = await findOwn(ctx, input.itemId, "WorkItem");
  if (!found.ok) return found;

  const refused = ownership({ kind: "agent", agent }, "write_handoff", {
    itemKind: found.output.kind as WorkItemKind,
    labels: input.report ? ["ReadinessReport"] : [],
  });
  if (refused) return guardFail(ctx, refused);

  const written = await writeHandoff(memoryCtx(ctx), {
    itemId: input.itemId,
    summary: input.summary,
    outputIds: input.outputIds,
    report: input.report,
    createdBy: agent,
    now: ctx.now(),
  });
  if (!written) return notFound(`WorkItem ${input.itemId}`);

  const projectId = ctx.binding.projectId;
  ctx.events.emit(projectId, "node.written", {
    label: "WorkItem",
    id: written.item.id,
    version: written.item.version,
    summary: `Handoff on the ${written.item.kind} item`,
  });
  if (written.reportId) {
    ctx.events.emit(projectId, "node.written", {
      label: "ReadinessReport",
      id: written.reportId,
      version: 1,
      summary: "Readiness report",
    });
  }
  return ok({ itemId: written.item.id, reportId: written.reportId });
}
