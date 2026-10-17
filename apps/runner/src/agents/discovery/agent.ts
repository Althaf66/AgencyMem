// The Discovery agent (agent-prompts.md section 3): finds contradictions, open questions and unclear
// points across the current facts, and writes each as a question with its five parts.
import { loadPrompt, type Agent, type Recall } from "../../agent";
import { DiscoveryOutput } from "./output";

/** Reference errors the model can repair: an unknown fact, a contradiction from one episode. */
export function checkQuestions(output: DiscoveryOutput, recall: Recall): string[] {
  const facts = new Map((recall.context.facts ?? []).map((f) => [f.id, f.episodeIds]));
  const errors: string[] = [];
  output.questions.forEach((q, i) => {
    for (const id of q.factIds) {
      if (!facts.has(id))
        errors.push(`questions.${i}.factIds: ${id} is not a current fact in CONTEXT`);
    }
    if (q.kind !== "contradiction") return;
    if (!q.contradictionSummary) {
      errors.push(`questions.${i}.contradictionSummary is required for a contradiction`);
    }
    const distinct = [...new Set(q.factIds)];
    if (distinct.length < 2) {
      errors.push(`questions.${i}: a contradiction needs at least 2 different facts`);
      return;
    }
    const episodes = new Set(distinct.flatMap((id) => facts.get(id) ?? []));
    if (distinct.every((id) => facts.has(id)) && episodes.size < 2) {
      errors.push(`questions.${i}: a contradiction needs facts from at least 2 different episodes`);
    }
  });
  return errors;
}

export const discovery: Agent<DiscoveryOutput> = {
  id: "discovery",
  kinds: ["discovery"],
  tier: "deep",
  maxTokens: 8000, // agent-prompts.md, Model request: up to 20 questions with sources
  task: "Find the contradictions, open questions and unclear points.",
  prompt: await loadPrompt(import.meta.url, "Discovery"),
  output: DiscoveryOutput,
  handoff: ["discovery"],
  select: (recall) => ({
    facts: recall.context.facts ?? [],
    entities: recall.context.entities ?? [],
    documents: recall.context.documents ?? [],
  }),
  check: checkQuestions,
  async act(output, recall, act) {
    const questions = output.questions.map(({ contradictionSummary, ...q }) =>
      contradictionSummary && q.kind === "contradiction"
        ? { ...q, contradiction: { summary: contradictionSummary } }
        : q,
    );
    const written = await act.call("write_question", { itemId: recall.item.id, questions });
    await act.say(`Wrote ${written.questionIds.length} questions`);
    const count = (kind: string) => output.questions.filter((q) => q.kind === kind).length;
    return {
      outputIds: [...written.questionIds, ...written.contradictionIds, ...written.assumptionIds],
      summary: `${count("contradiction")} contradictions, ${count("open")} open, ${count("unclear")} unclear`,
    };
  },
};
