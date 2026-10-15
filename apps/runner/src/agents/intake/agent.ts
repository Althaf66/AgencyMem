// The Intake agent (agent-prompts.md section 2): turns one document into atomic facts with their
// sources. intake_answer items (an answer turned into facts) arrive with the answers in task 2.7.
import { loadPrompt, type Agent, type Recall } from "../../agent";
import { IntakeOutput } from "./output";

/** Reference errors the model can repair: no facts, an episode not in CONTEXT, a wrong subject. */
export function checkFacts(output: IntakeOutput, recall: Recall): string[] {
  if (output.facts.length === 0) return ["no facts found"];
  const episodes = new Set((recall.context.episodes ?? []).map((e) => e.id));
  const errors: string[] = [];
  output.facts.forEach((fact, i) => {
    for (const id of fact.episodeIds) {
      if (!episodes.has(id))
        errors.push(`facts.${i}.episodeIds: ${id} is not an episode in CONTEXT`);
    }
    if (fact.subject !== fact.entity.key) {
      errors.push(`facts.${i}.subject must be the same key as entity.key (${fact.entity.key})`);
    }
  });
  return errors;
}

export const intake: Agent<IntakeOutput> = {
  id: "intake",
  kinds: ["intake"],
  tier: "thin",
  task: "Extract the facts in these episodes.",
  prompt: await loadPrompt(import.meta.url, "Intake"),
  output: IntakeOutput,
  handoff: ["intake"],
  select: (recall) => ({
    episodes: recall.context.episodes ?? [],
    entities: recall.context.entities ?? [],
  }),
  check: checkFacts,
  async act(output, recall, act) {
    const written = await act.call("write_fact", { itemId: recall.item.id, facts: output.facts });
    const n = written.factIds.length;
    await act.say(`Wrote ${n} facts`);
    const document = recall.context.episodes?.[0]?.documentName ?? "the document";
    return {
      outputIds: [...written.factIds, ...written.entityIds],
      summary: `${n} facts from ${document}`,
    };
  },
};
