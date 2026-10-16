import type { ToolInput, ToolOutput, WorkItemKind } from "@agencymem/contracts";
import { reportDefect } from "@agencymem/memory";
import { ownership, reject } from "../guards";
import {
  agentOf,
  findOwn,
  guardFail,
  memoryCtx,
  ok,
  readNode,
  type Outcome,
  type ToolCtx,
} from "./common";

/**
 * report_defect (contracts.md section 7). Guards: ownership (a maintenance item), source (the
 * CodeChange is the project's, and the report is the item's own bug_report Episode). Writes the
 * Defect, CAUSED_BY the commit and REPORTED_IN the report, in one query.
 */
export async function reportDefectTool(
  ctx: ToolCtx,
  input: ToolInput<"report_defect">,
): Promise<Outcome<ToolOutput<"report_defect">>> {
  const { agent } = agentOf(ctx);
  const found = await findOwn(ctx, input.itemId, "WorkItem");
  if (!found.ok) return found;
  const refused = ownership({ kind: "agent", agent }, "report_defect", {
    itemKind: found.output.kind as WorkItemKind,
  });
  if (refused) return guardFail(ctx, refused);

  const { projectId } = ctx.binding;
  if (input.reportEpisodeId !== found.output.subjectId) {
    return guardFail(
      ctx,
      reject("source", "SOURCE_UNKNOWN", "reportEpisodeId is not this item's bug report."),
    );
  }
  const change = await readNode(ctx, input.codeChangeId);
  if (change?.label !== "CodeChange" || change.props.projectId !== projectId) {
    return guardFail(
      ctx,
      reject("source", "SOURCE_UNKNOWN", `${input.codeChangeId} is not a commit of this project.`),
    );
  }

  const defect = await reportDefect(memoryCtx(ctx), {
    title: input.title,
    severity: input.severity,
    codeChangeId: input.codeChangeId,
    reportEpisodeId: input.reportEpisodeId,
    createdBy: agent,
    now: ctx.now(),
  });
  if (!defect) {
    return guardFail(ctx, reject("source", "SOURCE_UNKNOWN", "The commit or the report is gone."));
  }
  ctx.events.emit(projectId, "node.written", {
    label: "Defect",
    id: defect.id,
    version: defect.version,
    summary: `Defect (${defect.severity}): ${defect.title}`.slice(0, 200),
  });
  return ok({ defectId: defect.id });
}
