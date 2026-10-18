// The Discovery agent's ask kind: answers a person's question on the Memory screen from the
// project's facts, product and design, with the facts it rests on. A second loop of the discovery
// agent, with its own prompt, output and worker id. It writes no node: the answer is the item's
// handoff, so the question, the answer and its sources stay in the graph for the next ask.
import { loadPrompt, type Agent, type Recall } from "../../agent";
import { AskOutput } from "./output";

/** Reference errors the model can repair: a fact id that is not a current fact. */
export function checkAnswer(output: AskOutput, recall: Recall): string[] {
  const facts = new Set((recall.context.facts ?? []).map((f) => f.id));
  return output.factIds
    .filter((id) => !facts.has(id))
    .map((id) => `factIds: ${id} is not a current fact in CONTEXT`);
}

export const ask: Agent<AskOutput> = {
  id: "discovery",
  worker: "discovery-2",
  kinds: ["ask"],
  tier: "thin",
  maxTokens: 1000,
  task: (recall) => `Answer this question: ${recall.context.ask?.question ?? ""}`,
  prompt: await loadPrompt(import.meta.url, "Discovery", "ask.md"),
  output: AskOutput,
  handoff: ["ask"], // the handoff is the answer the Memory screen shows
  select: (recall) => ({
    ask: recall.context.ask ?? null,
    facts: (recall.context.facts ?? []).map((f) => ({ id: f.id, statement: f.statement })),
    requirements: (recall.context.requirements ?? []).map((r) => ({ key: r.key, text: r.text })),
    features: (recall.context.features ?? []).map((f) => ({ key: f.key, name: f.name })),
    design: recall.context.design ?? [],
  }),
  check: checkAnswer,
  async act(output, _recall, act) {
    const factIds = [...new Set(output.factIds)];
    await act.say(`Answered from ${factIds.length} facts`);
    return { outputIds: factIds, summary: output.answer };
  },
};
