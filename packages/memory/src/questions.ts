// Questions, their Assumptions and Contradictions (write_question). One Cypher query per call.
import { text, type Actor, type QuestionKind } from "@agencymem/contracts";
import { writeQuery } from "@agencymem/graph/write";
import { monotonicFactory, ulid } from "ulid";
import type { Ctx } from "./ctx";

// Monotonic, so the questions of one call keep the agent's order by id (read/questions.cypher).
const questionId = monotonicFactory();

export type QuestionWrite = {
  kind: QuestionKind;
  text: string;
  recommended: string;
  reasoning: string;
  approach: string;
  assumption: string;
  factIds: string[];
  /** A contradiction's summary; required for kind contradiction. */
  contradiction: string | null;
};

/**
 * Writes the Questions of one write_question call. Each id list follows the order of `questions`;
 * `contradictionIds` has one id per contradiction question, in order.
 */
export async function writeQuestions(
  ctx: Ctx,
  input: { questions: QuestionWrite[]; createdBy: Actor; now: number },
): Promise<{ questionIds: string[]; contradictionIds: string[]; assumptionIds: string[] }> {
  const questions = input.questions.map((q) => ({
    id: questionId(),
    kind: q.kind,
    text: text(200).parse(q.text), // checked before it is written
    recommended: text(400).parse(q.recommended),
    reasoning: text(600).parse(q.reasoning),
    approach: text(600).parse(q.approach),
    assumption: text(300).parse(q.assumption),
    assumptionId: ulid(),
    factIds: [...new Set(q.factIds)], // one edge per fact
    contradiction:
      q.kind === "contradiction" ? { id: ulid(), summary: text(300).parse(q.contradiction) } : null,
  }));
  if (questions.length === 0) return { questionIds: [], contradictionIds: [], assumptionIds: [] };

  await writeQuery(ctx.db, ctx.graph, "write/write-questions", {
    projectId: ctx.projectId,
    questions,
    createdBy: input.createdBy,
    now: input.now,
  });
  return {
    questionIds: questions.map((q) => q.id),
    contradictionIds: questions.flatMap((q) => (q.contradiction ? [q.contradiction.id] : [])),
    assumptionIds: questions.map((q) => q.assumptionId),
  };
}
