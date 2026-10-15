// The Architect (agent-prompts.md section 5): writes the design nodes and the sections of the Final
// PRD, the Technical Design and the Implementation Plan, and revises them from a note (chat text,
// a G3 rejection reason or a change request).
import { readFile } from "node:fs/promises";
import { loadPrompt, type Agent, type Recall } from "../../agent";
import { ArchitectOutput } from "./output";

// sample-app.md's stack, API rules and data-testid rule: static text, sent as CONTEXT.conventions.
const CONVENTIONS = await readFile(new URL("./conventions.md", import.meta.url), "utf8");

/** Reference errors the model can repair. */
export function checkDesign(output: ArchitectOutput, recall: Recall): string[] {
  const requirements = new Set((recall.context.requirements ?? []).map((r) => r.key));
  const known = new Set([
    ...requirements,
    ...(recall.context.features ?? []).map((f) => f.key),
    ...(recall.context.design ?? []).map((d) => d.key),
    ...output.nodes.map((n) => n.key),
  ]);
  const errors: string[] = [];
  output.nodes.forEach((n, i) => {
    for (const key of n.requirementKeys) {
      if (!requirements.has(key)) {
        errors.push(`nodes.${i}.requirementKeys: ${key} is not a requirement in CONTEXT`);
      }
    }
  });
  output.sections.forEach((s, i) => {
    for (const key of s.renders) {
      if (!known.has(key)) {
        errors.push(`sections.${i}.renders: ${key} is not a requirement, feature or design node`);
      }
    }
  });
  return errors;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const architect: Agent<ArchitectOutput> = {
  id: "architect",
  kinds: ["architect", "architect_revise"],
  tier: "deep",
  maxTokens: 8000, // agent-prompts.md section 1, Model request
  task: (recall) =>
    recall.item.kind === "architect_revise"
      ? `Change the design and the sections this note asks for: ${recall.item.note ?? ""}`
      : "Write the design and the three documents.",
  prompt: await loadPrompt(import.meta.url, "Architect"),
  output: ArchitectOutput,
  handoff: ["architect"],
  select: (recall) => ({
    requirements: recall.context.requirements ?? [],
    features: recall.context.features ?? [],
    facts: recall.context.facts ?? [],
    design: recall.context.design ?? [],
    docSections: recall.context.docSections ?? [],
    conventions: CONVENTIONS,
  }),
  check: checkDesign,
  async act(output, recall, act) {
    const written = await act.call("write_design", {
      itemId: recall.item.id,
      baseVersion: recall.project.designVersion,
      ...output,
    });
    const summary = `Design version ${written.designVersion}: ${plural(written.nodeIds.length, "design node")} and ${plural(written.sectionIds.length, "section")}`;
    await act.say(summary);
    return { outputIds: [...written.nodeIds, ...written.sectionIds], summary };
  },
};
