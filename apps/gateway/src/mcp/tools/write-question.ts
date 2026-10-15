import type { ToolInput, ToolOutput, WorkItemKind } from "@agencymem/contracts";
import { readQuery } from "@agencymem/graph";
import { writeQuestions } from "@agencymem/memory";
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
 * write_question (contracts.md section 7). Guards: ownership, source (every fact is a current Fact of
 * the project). A contradiction needs facts from at least 2 different episodes.
 */
export async function writeQuestionTool(
  ctx: ToolCtx,
  input: ToolInput<"write_question">,
): Promise<Outcome<ToolOutput<"write_question">>> {
  const { agent } = agentOf(ctx);
  const found = await findOwn(ctx, input.itemId, "WorkItem");
  if (!found.ok) return found;
  const refused = ownership({ kind: "agent", agent }, "write_question", {
    itemKind: found.output.kind as WorkItemKind,
  });
  if (refused) return guardFail(ctx, refused);

  const { graph, projectId } = ctx.binding;
  const current = await readQuery<{ id: string; episodeIds: string[] }>(
    ctx.db,
    graph,
    "read/current-facts",
    { projectId },
  );
  const episodes = new Map(current.map((f) => [f.id, f.episodeIds]));
  const missing = source(
    input.questions.map((q) => ({ ids: q.factIds })),
    new Set(episodes.keys()),
  );
  if (missing) return guardFail(ctx, missing);

  for (const [i, q] of input.questions.entries()) {
    if (q.kind !== "contradiction") continue;
    const facts = [...new Set(q.factIds)]; // the same fact twice is still one fact
    if (facts.length < 2) {
      return invalid(`Question ${i}: a contradiction needs at least 2 different facts.`);
    }
    const distinct = new Set(facts.flatMap((id) => episodes.get(id) ?? []));
    if (distinct.size < 2) {
      return invalid(
        `Question ${i}: a contradiction needs facts from at least 2 different episodes.`,
      );
    }
  }

  const written = await writeQuestions(memoryCtx(ctx), {
    questions: input.questions.map((q) => ({
      kind: q.kind,
      text: q.text,
      recommended: q.recommended,
      reasoning: q.reasoning,
      approach: q.approach,
      assumption: q.assumption,
      factIds: q.factIds,
      contradiction: q.contradiction?.summary ?? null,
    })),
    createdBy: agent,
    now: ctx.now(),
  });

  const batches = [
    ["Question", written.questionIds],
    ["Contradiction", written.contradictionIds],
    ["Assumption", written.assumptionIds],
  ] as const;
  for (const [label, ids] of batches) {
    if (ids.length === 0) continue;
    ctx.events.emit(projectId, "node.written", {
      label,
      id: ids[0]!,
      version: 1,
      summary: `${ids.length} ${label === "Question" ? "questions" : `${label.toLowerCase()}s`}`,
      ids: [...ids],
    });
  }
  return ok(written);
}
