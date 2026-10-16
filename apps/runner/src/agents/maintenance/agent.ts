// The Maintenance agent (agent-prompts.md section 8): links a bug report to the requirement it
// breaks and the commit that caused it (report_defect), and proposes a fix card that waits for G6
// (propose_fix).
import { loadPrompt, type Agent, type Recall } from "../../agent";
import { MaintenanceOutput } from "./output";

/** Reference errors the model can repair. */
export function checkFix(output: MaintenanceOutput, recall: Recall): string[] {
  const requirements = new Set((recall.context.requirements ?? []).map((r) => r.key));
  const shas = new Set(
    (recall.context.codeChanges ?? []).filter((c) => c.linked).map((c) => c.sha),
  );
  const design = new Set((recall.context.design ?? []).map((d) => d.key));
  const errors: string[] = [];
  if (!requirements.has(output.requirementKey)) {
    errors.push(`requirementKey: ${output.requirementKey} is not a requirement in CONTEXT`);
  }
  if (!shas.has(output.codeChangeSha)) {
    errors.push(`codeChangeSha: ${output.codeChangeSha} is not a linked code change in CONTEXT`);
  }
  for (const key of output.fix.designKeys) {
    if (!design.has(key)) errors.push(`fix.designKeys: ${key} is not a design node in CONTEXT`);
  }
  return errors;
}

/** The next free card number: one more than the highest CARD-nn on the board. */
function nextCard(recall: Recall): number {
  const numbers = (recall.context.tasks ?? []).map((t) => Number(t.key.slice("CARD-".length)));
  return Math.max(0, ...numbers) + 1;
}

export const maintenance: Agent<MaintenanceOutput> = {
  id: "maintenance",
  kinds: ["maintenance"],
  tier: "deep",
  task: "Find the requirement this bug breaks and the code change that caused it. Propose a fix card.",
  prompt: await loadPrompt(import.meta.url, "Maintenance"),
  output: MaintenanceOutput,
  handoff: [], // stage-machine.md section 3: report_defect, propose_fix, complete_item
  select: (recall) => ({
    defect: recall.context.defect,
    requirements: recall.context.requirements ?? [],
    tasks: recall.context.tasks ?? [],
    codeChanges: recall.context.codeChanges ?? [],
    design: recall.context.design ?? [],
  }),
  check: checkFix,
  async act(output, recall, act) {
    const change = recall.context.codeChanges!.find((c) => c.sha === output.codeChangeSha)!;
    const { defectId } = await act.call("report_defect", {
      itemId: recall.item.id,
      title: output.title,
      severity: output.severity,
      codeChangeId: change.id,
      reportEpisodeId: recall.context.defect!.reportEpisodeId,
      reasoning: output.reasoning,
    });
    // The runner names the card: the next free CARD-nn, ordered after the last card (the Planner
    // gives CARD-nn the order nn × 10), and its criteria AC-nn-1, AC-nn-2 ...
    const n = nextCard(recall);
    const number = String(n).padStart(2, "0");
    const key = `CARD-${number}`;
    const { taskId, gateId } = await act.call("propose_fix", {
      itemId: recall.item.id,
      defectId,
      card: {
        key,
        title: output.fix.title,
        description: output.fix.description,
        lane: output.fix.lane,
        order: n * 10,
        requirementKey: output.requirementKey,
        designKeys: output.fix.designKeys,
        dependsOn: [],
        criteria: output.fix.criteria.map((k, i) => ({
          key: `AC-${number}-${i + 1}`,
          text: k.text,
          testIds: k.testIds,
        })),
      },
    });
    const summary = `Defect on ${change.taskKey ?? change.sha.slice(0, 7)} (${output.severity}); fix card ${key} waits for G6`;
    await act.say(summary);
    return { outputIds: [defectId, taskId, gateId], summary };
  },
};
