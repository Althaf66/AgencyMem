// The Proposal agent's change_request kind (agent-prompts.md section 4): turns a change request into
// replaced facts, then rewrites the requirement texts it changes. A second loop of the proposal
// agent, with its own prompt, output and worker id.
import { loadPrompt, type Agent, type Recall } from "../../agent";
import { ChangeRequestOutput } from "./output";

/** Reference errors the model can repair. */
export function checkChanges(output: ChangeRequestOutput, recall: Recall): string[] {
  const facts = new Set((recall.context.facts ?? []).map((f) => f.id));
  const keys = new Set((recall.context.requirements ?? []).map((r) => r.key));
  const errors: string[] = [];
  output.changes.forEach((c, i) => {
    if (!facts.has(c.oldFactId)) {
      errors.push(`changes.${i}.oldFactId: ${c.oldFactId} is not a current fact in CONTEXT`);
    }
  });
  output.requirementUpdates.forEach((u, i) => {
    if (!keys.has(u.key))
      errors.push(`requirementUpdates.${i}.key: ${u.key} is not a requirement in CONTEXT`);
  });
  if (output.outcome === "needs_scope" && output.changes.length) {
    errors.push("outcome: needs_scope comes with no changes");
  }
  return errors;
}

export const changeRequest: Agent<ChangeRequestOutput> = {
  id: "proposal",
  worker: "proposal-2",
  kinds: ["change_request"],
  tier: "deep",
  task: "Apply this change request to the facts.",
  prompt: await loadPrompt(import.meta.url, "Proposal", "change-request.md"),
  output: ChangeRequestOutput,
  handoff: [], // stage-machine.md section 3: change_request writes no handoff
  select: (recall) => ({
    changeRequest: recall.context.changeRequest ?? null,
    facts: recall.context.facts ?? [],
    requirements: recall.context.requirements ?? [],
    features: recall.context.features ?? [],
  }),
  check: checkChanges,
  async act(output, recall, act) {
    const crId = recall.context.changeRequest?.id ?? recall.item.subjectId!;
    const recorded = await act.call("record_change_request", {
      itemId: recall.item.id,
      crId,
      changes: output.changes,
      ...(output.outcome ? { outcome: output.outcome } : {}),
    });
    const { taskIds, docSectionIds } = recorded.flagged;
    await act.say(
      `${recorded.crStatus}: ${output.changes.length} facts changed, flagged ${taskIds.length} cards and ${docSectionIds.length} sections`,
    );
    const outputIds = [...recorded.newFactIds];
    if (output.requirementUpdates.length) {
      // write_product with every current requirement and feature, the new texts, the same
      // estimates, and fact ids moved from each replaced fact to its replacement.
      const replaced = new Map(
        output.changes.map((c, i) => [c.oldFactId, recorded.newFactIds[i]!]),
      );
      const texts = new Map(output.requirementUpdates.map((u) => [u.key, u.text]));
      const product = await act.call("write_product", {
        itemId: recall.item.id,
        baseVersion: recall.project.productVersion,
        requirements: (recall.context.requirements ?? []).map((r) => ({
          key: r.key,
          text: texts.get(r.key) ?? r.text,
          priority: r.priority,
          factIds: r.factIds.map((id) => replaced.get(id) ?? id),
        })),
        features: (recall.context.features ?? []).map((f) => ({
          key: f.key,
          name: f.name,
          featureKind: f.featureKind,
          requirementKeys: f.requirementKeys,
          estimate: {
            rawHours: f.estimate.rawHours,
            hours: f.estimate.hours,
            basis: f.estimate.basis,
            lessonIds: f.estimate.lessonIds,
          },
        })),
      });
      await act.say(`Updated ${output.requirementUpdates.length} requirements`);
      outputIds.push(...product.requirementIds);
    }
    const s = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
    return {
      outputIds,
      summary: `${s(output.changes.length, "fact")} changed; flagged ${s(taskIds.length, "card")} and ${s(docSectionIds.length, "section")}`,
    };
  },
};
