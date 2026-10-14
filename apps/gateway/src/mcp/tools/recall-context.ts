import {
  WorkItem,
  type AgentId,
  type Context,
  type ToolInput,
  type ToolOutput,
  type WorkItemKind,
} from "@agencymem/contracts";
import { readQuery } from "@agencymem/graph";
import { projectInfo } from "../../project-info";
import { CLAIMS } from "../guards";
import { fail, findOwn, ok, type Outcome, type ToolCtx } from "./common";

/** The agent that claims a kind of work item (stage-machine.md section 3). */
function agentFor(kind: WorkItemKind): AgentId {
  const entry = Object.entries(CLAIMS).find(([, kinds]) => kinds.includes(kind));
  return (entry?.[0] ?? "build") as AgentId; // every kind has exactly one claimer
}

/**
 * recall_context (contracts.md section 7). Guard: tenancy. Returns the item, its project and the
 * context groups. Phase 1 fills `handoffs`; each other group arrives with the agent that reads it
 * (agent-prompts.md). The JSON stays within CONTEXT_RECALL_MAX_CHARS: handoffs are cut first, to
 * the newest 5.
 */
export async function recallContextTool(
  ctx: ToolCtx,
  input: ToolInput<"recall_context">,
): Promise<Outcome<ToolOutput<"recall_context">>> {
  const found = await findOwn(ctx, input.itemId, "WorkItem");
  if (!found.ok) return found;
  const item = WorkItem.parse(found.output);
  const project = await projectInfo(ctx.db, ctx.binding.projectId);
  if (!project)
    return fail({ code: "NOT_FOUND", reason: "The session's project no longer exists." });

  const rows = await readQuery<{ kind: WorkItemKind; summary: string; doneAt: number }>(
    ctx.db,
    ctx.binding.graph,
    "read/handoffs",
    { projectId: ctx.binding.projectId },
  );
  const context: Context = {
    handoffs: rows.map((r) => ({ ...r, agent: agentFor(r.kind) })),
  };

  let chars = JSON.stringify({ item, project, context }).length;
  if (chars > ctx.recallMaxChars && context.handoffs && context.handoffs.length > 5) {
    context.handoffs = context.handoffs.slice(0, 5); // newest first
    chars = JSON.stringify({ item, project, context }).length;
  }
  return ok({ item, project, context, chars });
}
