import {
  Document,
  FeatureKind,
  WorkItem,
  type AgentId,
  type Context,
  type ToolInput,
  type ToolOutput,
  type WorkItemKind,
} from "@agencymem/contracts";
import { AGENCY_GRAPH, readQuery } from "@agencymem/graph";
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

  // agent-prompts.md section 2: an intake_answer item reads its answer episode, the question it
  // answers, that question's facts, and every entity.
  if (item.kind === "intake_answer" && item.subjectId) {
    type Ctx = Required<Context>;
    const [row] = await readQuery<{
      episode: Ctx["episodes"][number];
      question: Ctx["questions"][number];
      facts: Ctx["facts"];
    }>(ctx.db, graph, "read/answer-context", { projectId, episodeId: item.subjectId });
    context.episodes = row ? [row.episode] : [];
    context.questions = row ? [row.question] : [];
    context.facts = row?.facts ?? [];
    context.entities = await readQuery<NonNullable<Context["entities"]>[number]>(
      ctx.db,
      graph,
      "read/entities",
      { projectId },
    );
  }

  // agent-prompts.md section 3: a discovery item reads the current facts, the entities and the
  // documents (names and word counts).
  if (item.kind === "discovery") {
    const facts = await readQuery<
      Omit<NonNullable<Context["facts"]>[number], "validTo" | "replacedBy">
    >(ctx.db, graph, "read/current-facts", { projectId });
    context.facts = facts.map((f) => ({ ...f, validTo: null, replacedBy: null }));
    context.entities = await readQuery<NonNullable<Context["entities"]>[number]>(
      ctx.db,
      graph,
      "read/entities",
      { projectId },
    );
    const documents = await readQuery<{ d: { properties: Record<string, unknown> } }>(
      ctx.db,
      graph,
      "read/documents",
      { projectId },
    );
    context.documents = documents
      .map((r) => Document.parse(r.d.properties))
      .filter((d) => d.status === "processed")
      .map((d) => ({ id: d.id, name: d.name, wordCount: d.wordCount }));
  }

  // agent-prompts.md section 4: a proposal item reads the current facts, the questions with their
  // answers, the entities, the lessons of every featureKind in every band (agency graph), and the
  // current product (empty the first time).
  if (item.kind === "proposal") {
    type Ctx = Required<Context>;
    const facts = await readQuery<Omit<Ctx["facts"][number], "validTo" | "replacedBy">>(
      ctx.db,
      graph,
      "read/current-facts",
      { projectId },
    );
    context.facts = facts.map((f) => ({ ...f, validTo: null, replacedBy: null }));
    const questions = await readQuery<{
      q: { properties: Record<string, unknown> };
      a: { properties: Record<string, unknown> };
      sources: { factId: string }[];
      answer: { episodeId: string; text: string } | null;
    }>(ctx.db, graph, "read/questions", { projectId });
    context.questions = questions.map(({ q, a, sources, answer }) => ({
      id: q.properties.id as string,
      kind: q.properties.kind as Ctx["questions"][number]["kind"],
      text: q.properties.text as string,
      recommended: q.properties.recommended as string,
      status: q.properties.status as Ctx["questions"][number]["status"],
      factIds: [...new Set(sources.map((s) => s.factId))],
      assumption: {
        id: a.properties.id as string,
        text: a.properties.text as string,
        status: a.properties.status as Ctx["questions"][number]["assumption"]["status"],
      },
      answer: answer && { episodeId: answer.episodeId, text: answer.text },
    }));
    context.entities = await readQuery<Ctx["entities"][number]>(ctx.db, graph, "read/entities", {
      projectId,
    });
    const lessons = await readQuery<Ctx["lessons"][number] & { projectIds: string[] }>(
      ctx.db,
      AGENCY_GRAPH,
      "read/similar-lessons",
      { featureKinds: FeatureKind.options },
    );
    context.lessons = lessons.map(({ id, featureKind, clarityBand, ratio, n, text }) => ({
      id,
      featureKind,
      clarityBand,
      ratio,
      n,
      text,
    }));
    context.requirements = await readQuery<Ctx["requirements"][number]>(
      ctx.db,
      graph,
      "read/requirements",
      { projectId },
    );
    context.features = await readQuery<Ctx["features"][number]>(ctx.db, graph, "read/features", {
      projectId,
    });
  }

  // agent-prompts.md section 4: a change_request item reads its ChangeRequest, the current facts
  // and the current product.
  if (item.kind === "change_request" && item.subjectId) {
    type Ctx = Required<Context>;
    const [changeRequest] = await readQuery<Ctx["changeRequest"]>(
      ctx.db,
      graph,
      "read/change-request",
      { projectId, crId: item.subjectId },
    );
    if (changeRequest) context.changeRequest = changeRequest;
    const facts = await readQuery<Omit<Ctx["facts"][number], "validTo" | "replacedBy">>(
      ctx.db,
      graph,
      "read/current-facts",
      { projectId },
    );
    context.facts = facts.map((f) => ({ ...f, validTo: null, replacedBy: null }));
    context.requirements = await readQuery<Ctx["requirements"][number]>(
      ctx.db,
      graph,
      "read/requirements",
      { projectId },
    );
    context.features = await readQuery<Ctx["features"][number]>(ctx.db, graph, "read/features", {
      projectId,
    });
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
