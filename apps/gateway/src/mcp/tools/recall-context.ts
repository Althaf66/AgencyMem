import {
  Document,
  FeatureKind,
  WorkItem,
  type AgentId,
  type Context,
  type ReadinessCheck,
  type ToolInput,
  type ToolOutput,
  type WorkItemKind,
} from "@agencymem/contracts";
import { AGENCY_GRAPH, readQuery } from "@agencymem/graph";
import { projectInfo } from "../../project-info";
import { CLAIMS } from "../guards";
import { fail, findOwn, ok, type Outcome, type ToolCtx } from "./common";

type ReadinessRow = {
  cards: number;
  notDone: string[];
  openAssumptions: string[];
  openDefects: string[];
  requirements: number;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The Launch agent's four graph checks (agent-prompts.md section 10). A check passes when no node
 * fails it; `uncovered` are coverage.cypher's rows (task 5.1).
 */
export function readinessChecks(row: ReadinessRow, uncovered: string[]): ReadinessCheck[] {
  const check = (
    name: ReadinessCheck["name"],
    nodeIds: string[],
    failed: string,
    passed: string,
  ): ReadinessCheck => ({
    name,
    passed: nodeIds.length === 0,
    detail: (nodeIds.length ? failed : passed).slice(0, 200),
    nodeIds,
  });
  return [
    check(
      "cards_done",
      row.notDone,
      `${row.notDone.length} of ${plural(row.cards, "card")} are not Done`,
      `All ${plural(row.cards, "card")} are Done`,
    ),
    check(
      "coverage",
      uncovered,
      `${uncovered.length} of ${plural(row.requirements, "requirement")} have no passing e2e test`,
      `All ${plural(row.requirements, "requirement")} pass`,
    ),
    check(
      "open_assumptions",
      row.openAssumptions,
      plural(row.openAssumptions.length, "open assumption"),
      "none",
    ),
    check("open_defects", row.openDefects, plural(row.openDefects.length, "open defect"), "none"),
  ];
}

/** The agent that claims a kind of work item (stage-machine.md section 3). */
export function agentFor(kind: WorkItemKind): AgentId {
  const entry = Object.entries(CLAIMS).find(([, kinds]) => kinds.includes(kind));
  return (entry?.[0] ?? "build") as AgentId; // every kind has exactly one claimer
}

type DesignRow = NonNullable<Context["design"]>[number];

/** The design nodes; method and path only on an Endpoint (a missing property reads as null). */
async function readDesign(db: ToolCtx["db"], graph: string, projectId: string) {
  const rows = await readQuery<
    Omit<DesignRow, "method" | "path"> & { method: string | null; path: string | null }
  >(db, graph, "read/design", { projectId });
  return rows.map(({ method, path, ...n }): DesignRow =>
    method && path ? { ...n, method, path } : n,
  );
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
  type Ctx = Required<Context>;
  const currentFacts = async (): Promise<Ctx["facts"]> => {
    const facts = await readQuery<Omit<Ctx["facts"][number], "validTo" | "replacedBy">>(
      ctx.db,
      graph,
      "read/current-facts",
      { projectId },
    );
    return facts.map((f) => ({ ...f, validTo: null, replacedBy: null }));
  };
  const currentProduct = async () => ({
    requirements: await readQuery<Ctx["requirements"][number]>(ctx.db, graph, "read/requirements", {
      projectId,
    }),
    features: await readQuery<Ctx["features"][number]>(ctx.db, graph, "read/features", {
      projectId,
    }),
  });

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
    context.facts = await currentFacts();
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
    context.facts = await currentFacts();
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
    Object.assign(context, await currentProduct());
  }

  // agent-prompts.md section 4: a change_request item reads its ChangeRequest, the current facts
  // and the current product.
  if (item.kind === "change_request" && item.subjectId) {
    const [changeRequest] = await readQuery<Ctx["changeRequest"]>(
      ctx.db,
      graph,
      "read/change-request",
      { projectId, crId: item.subjectId },
    );
    if (changeRequest) context.changeRequest = changeRequest;
    context.facts = await currentFacts();
    Object.assign(context, await currentProduct());
  }

  // agent-prompts.md section 5: an architect or architect_revise item reads the requirements, the
  // features, the current facts, and the current design and sections (empty the first time).
  // section 6: a planner item reads the product, the design and the Implementation Plan's sections.
  const architect = item.kind === "architect" || item.kind === "architect_revise";
  const planner = item.kind === "planner" || item.kind === "replan";
  if (architect || planner) {
    Object.assign(context, await currentProduct());
    if (architect) context.facts = await currentFacts();
    context.design = await readDesign(ctx.db, graph, projectId);
    const sections = await readQuery<{
      s: { properties: Record<string, unknown> };
      renders: { key: string }[];
    }>(ctx.db, graph, "read/doc-sections", { projectId, doc: architect ? null : "plan" });
    context.docSections = sections.map(({ s, renders }) => ({
      id: s.properties.id as string,
      doc: s.properties.doc as Ctx["docSections"][number]["doc"],
      order: s.properties.order as number,
      title: s.properties.title as string,
      body: s.properties.body as string,
      stale: s.properties.stale as boolean,
      renders: renders.map((n) => n.key),
    }));
  }

  // section 6, replan: also its ChangeRequest, the current facts with the ones it ended, and the
  // cards it sent to Rework, with their versions.
  if (item.kind === "replan" && item.subjectId) {
    const crId = item.subjectId;
    const [changeRequest] = await readQuery<Ctx["changeRequest"]>(
      ctx.db,
      graph,
      "read/change-request",
      { projectId, crId },
    );
    if (changeRequest) context.changeRequest = changeRequest;
    const ended = await readQuery<Ctx["facts"][number]>(ctx.db, graph, "read/ended-facts", {
      projectId,
      crId,
    });
    context.facts = [...(await currentFacts()), ...ended];
    const flagged = await readQuery<{ id: string }>(ctx.db, graph, "read/flagged-rework", {
      projectId,
      crId,
    });
    context.tasks = [];
    for (const { id } of flagged) {
      context.tasks.push(
        ...(await readQuery<Ctx["tasks"][number]>(ctx.db, graph, "read/task", {
          projectId,
          taskId: id,
        })),
      );
    }
  }

  // agent-prompts.md section 7: a write_tests item reads its card, the Endpoints, Screens and
  // DataEntities the card uses, and the current facts (seed values such as staff names and hours).
  if (item.kind === "write_tests" && item.subjectId) {
    const tasks = await readQuery<Ctx["tasks"][number]>(ctx.db, graph, "read/task", {
      projectId,
      taskId: item.subjectId,
    });
    context.tasks = tasks;
    const uses = new Set(tasks.flatMap((t) => t.designKeys));
    context.design = (await readDesign(ctx.db, graph, projectId)).filter(
      (n) => uses.has(n.key) && ["Endpoint", "Screen", "DataEntity"].includes(n.label),
    );
    context.facts = await currentFacts();
  }

  // agent-prompts.md section 7, test_run: the item's commit, and its card with the TestCases to run.
  if (item.kind === "test_run" && item.subjectId) {
    const changes = await readQuery<
      NonNullable<Context["codeChanges"]>[number] & { taskId: string | null }
    >(ctx.db, graph, "read/code-change", { projectId, id: item.subjectId });
    context.codeChanges = changes.map((c) => ({
      id: c.id,
      sha: c.sha,
      branch: c.branch,
      taskKey: c.taskKey,
      files: c.files,
      message: c.message,
      committedAt: c.committedAt,
      linked: c.linked,
    }));
    const taskId = changes[0]?.taskId;
    if (taskId) {
      context.tasks = await readQuery<Ctx["tasks"][number]>(ctx.db, graph, "read/task", {
        projectId,
        taskId,
      });
    }
  }

  // agent-prompts.md section 7, e2e: every card with the TestCases to run on main.
  if (item.kind === "e2e") {
    context.tasks = await readQuery<Ctx["tasks"][number]>(ctx.db, graph, "read/task", {
      projectId,
      taskId: null,
    });
  }

  // agent-prompts.md section 10: the four graph checks, and every recorded commit for drift.
  if (item.kind === "launch") {
    const [row] = await readQuery<ReadinessRow>(ctx.db, graph, "read/readiness", { projectId });
    const uncovered = await readQuery<{ id: string }>(ctx.db, graph, "read/coverage", {
      projectId,
    });
    context.readiness = readinessChecks(
      row!,
      uncovered.map((r) => r.id),
    );
    const changes = await readQuery<NonNullable<Context["codeChanges"]>[number]>(
      ctx.db,
      graph,
      "read/code-change",
      { projectId, id: null },
    );
    context.codeChanges = changes.map((c) => ({
      id: c.id,
      sha: c.sha,
      branch: c.branch,
      taskKey: c.taskKey,
      files: c.files,
      message: c.message,
      committedAt: c.committedAt,
      linked: c.linked,
    }));
  }

  // A merge item reads its card: the runner merges card/<key>.
  if (item.kind === "merge" && item.subjectId) {
    context.tasks = await readQuery<Ctx["tasks"][number]>(ctx.db, graph, "read/task", {
      projectId,
      taskId: item.subjectId,
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
  // Then design and section bodies. codeChanges are never cut: a launch item's missing commit would
  // read as drift.
  if (chars > ctx.recallMaxChars && (context.design || context.docSections)) {
    context.design = context.design?.map((n) => ({ ...n, body: n.body.slice(0, 300) }));
    context.docSections = context.docSections?.map((s) => ({ ...s, body: s.body.slice(0, 300) }));
    chars = size();
  }
  return ok({ item, project, context, chars });
}
