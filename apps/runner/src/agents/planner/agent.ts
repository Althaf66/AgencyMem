// The Planner (agent-prompts.md section 6): splits the approved design into cards a build run can
// finish in one go (planner items, create mode), and updates the cards a change request sent to
// Rework (replan items, update mode).
import { readFile } from "node:fs/promises";
import { findCycle } from "@agencymem/contracts";
import { loadPrompt, type Agent, type Recall } from "../../agent";
import { PlannerOutput } from "./output";

const MAX_CARDS = 10; // the cost cap
// The data-testid rule and the reserved names (sample-app.md section 8), shared with the Test agent.
const TESTIDS = await readFile(new URL("../testids.md", import.meta.url), "utf8");

/** Reference errors the model can repair. */
export function checkCards(output: PlannerOutput, recall: Recall): string[] {
  const requirements = new Set((recall.context.requirements ?? []).map((r) => r.key));
  const design = new Set((recall.context.design ?? []).map((d) => d.key));
  const cards = new Set(output.cards.map((c) => c.key));
  const replan = recall.item.kind === "replan";
  const rework = new Set((recall.context.tasks ?? []).map((t) => t.key));
  const errors: string[] = [];
  output.cards.forEach((c, i) => {
    if (replan && !rework.has(c.key)) {
      errors.push(`cards.${i}.key: ${c.key} is not a card in Rework in CONTEXT.tasks`);
    }
    if (!requirements.has(c.requirementKey)) {
      errors.push(`cards.${i}.requirementKey: ${c.requirementKey} is not a requirement in CONTEXT`);
    }
    for (const key of c.designKeys) {
      if (!design.has(key))
        errors.push(`cards.${i}.designKeys: ${key} is not a design node in CONTEXT`);
    }
    // A replan card may depend on any card of the board; the gateway checks those keys.
    for (const key of replan ? [] : c.dependsOn) {
      if (!cards.has(key)) errors.push(`cards.${i}.dependsOn: ${key} is not a card in the output`);
    }
    const number = c.key.slice("CARD-".length);
    c.criteria.forEach((k, j) => {
      if (!k.key.startsWith(`AC-${number}-`)) {
        errors.push(
          `cards.${i}.criteria.${j}.key: ${k.key} does not belong to ${c.key} (use AC-${number}-<n>)`,
        );
      }
    });
  });
  const cycle = findCycle(output.cards);
  if (cycle) errors.push(`cards.dependsOn: the cards form a cycle ${cycle.join(" -> ")}`);
  if (output.cards.length > MAX_CARDS) {
    errors.push(`cards: ${output.cards.length} cards is more than ${MAX_CARDS}; merge cards`);
  }
  return errors;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const planner: Agent<PlannerOutput> = {
  id: "planner",
  kinds: ["planner", "replan"],
  tier: "deep",
  maxTokens: 8000, // up to 10 cards with 3 criteria each
  task: (recall) =>
    recall.item.kind === "replan"
      ? "Update the cards in Rework for this change request."
      : "Write the cards.",
  prompt: `${await loadPrompt(import.meta.url, "Planner")}
${TESTIDS}`,
  output: PlannerOutput,
  handoff: ["planner"],
  select: (recall) => ({
    requirements: recall.context.requirements ?? [],
    features: recall.context.features ?? [],
    design: recall.context.design ?? [],
    docSections: recall.context.docSections ?? [],
    ...(recall.item.kind === "replan"
      ? {
          changeRequest: recall.context.changeRequest,
          facts: recall.context.facts ?? [],
          tasks: recall.context.tasks ?? [],
        }
      : {}),
  }),
  check: checkCards,
  async act(output, recall, act) {
    const replan = recall.item.kind === "replan";
    // Update mode sends each card's version as CONTEXT showed it (the version guard).
    const versions = new Map((recall.context.tasks ?? []).map((t) => [t.key, t.version]));
    const written = await act.call("write_cards", {
      itemId: recall.item.id,
      mode: replan ? "update" : "create",
      cards: replan
        ? output.cards.map((c) => ({ ...c, version: versions.get(c.key)! }))
        : output.cards,
    });
    const criteria = written.criterionIds.length;
    const summary = `${plural(written.taskIds.length, "card")} ${replan ? "revised in Rework" : "in Backlog"} with ${criteria} acceptance ${criteria === 1 ? "criterion" : "criteria"}`;
    await act.say(summary);
    return { outputIds: [...written.taskIds, ...written.criterionIds], summary };
  },
};
