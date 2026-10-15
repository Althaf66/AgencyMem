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
 * context groups: `handoffs` always, and the groups each item kind reads (agent-prompts.md); the
 * others arrive with the agents that read them. The JSON stays within CONTEXT_RECALL_MAX_CHARS.
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
  const { graph, projectId } = ctx.binding;

  // agent-prompts.md section 2: an intake item reads its Document's episodes and every entity.
  if (item.kind === "intake" && item.subjectId) {
    context.episodes = await readQuery<NonNullable<Context["episodes"]>[number]>(
      ctx.db,
      graph,
      "read/document-episodes",
      { projectId, documentId: item.subjectId },
    );
    context.entities = await readQuery<NonNullable<Context["entities"]>[number]>(
      ctx.db,
      graph,
      "read/entities",
      { projectId },
    );
  }

  // contracts.md section 7: cut until it fits, handoffs to the newest 5, then episode text to 300.
  const size = () => JSON.stringify({ item, project, context }).length;
  let chars = size();
  if (chars > ctx.recallMaxChars && context.handoffs && context.handoffs.length > 5) {
    context.handoffs = context.handoffs.slice(0, 5); // newest first
    chars = size();
  }
  if (chars > ctx.recallMaxChars && context.episodes) {
    context.episodes = context.episodes.map((e) => ({ ...e, text: e.text.slice(0, 300) }));
    chars = size();
  }
  return ok({ item, project, context, chars });
}
