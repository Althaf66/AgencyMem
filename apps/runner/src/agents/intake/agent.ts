// The Intake agent (agent-prompts.md section 2): turns one document, or one answer (intake_answer),
// into atomic facts with their sources.
import { loadPrompt, type Agent, type Recall } from "../../agent";
import { IntakeOutput } from "./output";

/**
 * Reference errors the model can repair: no facts, an episode or a replaced fact not in CONTEXT, a
 * wrong subject.
 */
export function checkFacts(output: IntakeOutput, recall: Recall): string[] {
  if (output.facts.length === 0) return ["no facts found"];
  const episodes = new Set((recall.context.episodes ?? []).map((e) => e.id));
  const facts = new Map((recall.context.facts ?? []).map((f) => [f.id, f]));
  const errors: string[] = [];
  output.facts.forEach((fact, i) => {
    for (const id of fact.episodeIds) {
      if (!episodes.has(id))
        errors.push(`facts.${i}.episodeIds: ${id} is not an episode in CONTEXT`);
    }
    const replaced = fact.replacesFactId ? facts.get(fact.replacesFactId) : undefined;
    if (fact.replacesFactId && !replaced) {
      errors.push(`facts.${i}.replacesFactId: ${fact.replacesFactId} is not a fact in CONTEXT`);
    } else if (replaced?.validTo != null) {
      errors.push(
        `facts.${i}.replacesFactId: ${replaced.id} is already replaced by ${replaced.replacedBy}; replace that one`,
      );
    }
    if (fact.subject !== fact.entity.key) {
      errors.push(`facts.${i}.subject must be the same key as entity.key (${fact.entity.key})`);
    }
  });
  return errors;
}

export const intake: Agent<IntakeOutput> = {
  id: "intake",
  kinds: ["intake", "intake_answer"],
  tier: "thin",
  task: "Extract the facts in these episodes.",
  prompt: await loadPrompt(import.meta.url, "Intake"),
  output: IntakeOutput,
  handoff: ["intake"],
  // An intake_answer item also reads the answered question and its facts.
  select: ({ context }) => ({
    episodes: context.episodes ?? [],
    entities: context.entities ?? [],
    ...(context.questions ? { questions: context.questions, facts: context.facts ?? [] } : {}),
  }),
  check: checkFacts,
  async act(output, recall, act) {
    const written = await act.call("write_fact", { itemId: recall.item.id, facts: output.facts });
    const n = written.factIds.length;
    await act.say(`Wrote ${n} facts`);
    const document =
      recall.item.kind === "intake_answer"
        ? "the answer"
        : (recall.context.episodes?.[0]?.documentName ?? "the document");
    return {
      outputIds: [...written.factIds, ...written.entityIds],
      summary: `${n} facts from ${document}`,
    };
  },
};
