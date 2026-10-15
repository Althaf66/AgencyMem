// The Proposal agent (agent-prompts.md section 4): writes the requirements and the features with
// raw estimates; the runner, not the model, applies the lessons to each raw estimate.
import type { ClarityBand, Context, FeatureKind } from "@agencymem/contracts";
import { loadPrompt, type Agent, type Recall } from "../../agent";
import { ProposalOutput } from "./output";

type Lesson = NonNullable<Context["lessons"]>[number];

/** The lesson ratio for one feature (agent-prompts.md, Estimate method), exactly as specified. */
export function adjust(
  raw: number,
  kind: FeatureKind,
  band: ClarityBand | null,
  lessons: Lesson[],
) {
  const exact = lessons.find((l) => l.featureKind === kind && l.clarityBand === band);
  if (exact)
    return {
      ratio: exact.ratio,
      used: [exact],
      basis: `raw ${raw} h × ${exact.ratio.toFixed(2)} (lesson ${band}, n=${exact.n})`,
    };
  const same = lessons.filter((l) => l.featureKind === kind); // fallback (C3)
  if (same.length) {
    const n = same.reduce((a, l) => a + l.n, 0);
    const ratio = same.reduce((a, l) => a + l.ratio * l.n, 0) / n;
    return {
      ratio,
      used: same,
      basis: `raw ${raw} h × ${ratio.toFixed(2)} (${kind} lessons, any band, n=${n})`,
    };
  }
  return { ratio: 1, used: [] as Lesson[], basis: `raw ${raw} h, no lesson` };
}

/** write_product's estimate: hours is raw × ratio to the nearest 0.5, and the basis says so. */
export function estimateFor(
  raw: number,
  kind: FeatureKind,
  band: ClarityBand | null,
  lessons: Lesson[],
) {
  const { ratio, used, basis } = adjust(raw, kind, band, lessons);
  const hours = Math.round(raw * ratio * 2) / 2;
  return { rawHours: raw, hours, basis: `${basis} = ${hours} h`, lessonIds: used.map((l) => l.id) };
}

const repeated = (keys: string[], path: string) =>
  keys.flatMap((key, i) =>
    keys.indexOf(key) !== i ? [`${path}.${i}.key: ${key} is used twice`] : [],
  );

/** Reference errors the model can repair (agent-prompts.md section 4 rules). */
export function checkProposal(output: ProposalOutput, recall: Recall): string[] {
  const facts = new Set((recall.context.facts ?? []).map((f) => f.id));
  const errors: string[] = [];
  output.requirements.forEach((r, i) => {
    for (const id of r.factIds) {
      if (!facts.has(id))
        errors.push(`requirements.${i}.factIds: ${id} is not a current fact in CONTEXT`);
    }
  });
  errors.push(
    ...repeated(
      output.requirements.map((r) => r.key),
      "requirements",
    ),
  );
  const keys = new Set(output.requirements.map((r) => r.key));
  output.features.forEach((f, i) => {
    const sum = f.parts.data + f.parts.api + f.parts.ui + f.parts.tests;
    if (sum !== f.rawHours)
      errors.push(`features.${i}: the parts sum to ${sum}, not rawHours ${f.rawHours}`);
    if (f.rawHours < 1 || f.rawHours > 24) {
      errors.push(`features.${i}.rawHours: ${f.rawHours} is outside 1 to 24`);
    }
    for (const key of f.requirementKeys) {
      if (!keys.has(key))
        errors.push(`features.${i}.requirementKeys: ${key} is not a requirement in the output`);
    }
  });
  errors.push(
    ...repeated(
      output.features.map((f) => f.key),
      "features",
    ),
  );
  if (output.features.length < 4 || output.features.length > 8) {
    errors.push(`features: ${output.features.length} features; write 4 to 8`);
  }
  return errors;
}

export const proposal: Agent<ProposalOutput> = {
  id: "proposal",
  kinds: ["proposal"], // change_request arrives with task 3.3
  tier: "deep",
  // agent-prompts.md section 4: a revision after a G2 rejection carries the reason as its note.
  // A first item that failed also has a note (the failure text), but no product exists yet.
  // ponytail: if a first item fails after write_product committed, its retry reads the failure
  // text as a reason; a flag on the item set by T9 would remove the guess.
  task: (recall) =>
    recall.item.note && (recall.context.requirements ?? []).length > 0
      ? `Revise the proposal. The client said: ${recall.item.note}`
      : "Write the requirements and the features with raw estimates.",
  prompt: await loadPrompt(import.meta.url, "Proposal"),
  output: ProposalOutput,
  handoff: ["proposal"],
  select: (recall) => ({
    facts: recall.context.facts ?? [],
    questions: recall.context.questions ?? [],
    entities: recall.context.entities ?? [],
    lessons: recall.context.lessons ?? [],
    requirements: recall.context.requirements ?? [],
    features: recall.context.features ?? [],
  }),
  check: checkProposal,
  async act(output, recall, act) {
    const band = recall.project.clarity?.band ?? null;
    const lessons = recall.context.lessons ?? [];
    const written = await act.call("write_product", {
      itemId: recall.item.id,
      baseVersion: recall.project.productVersion,
      requirements: output.requirements,
      features: output.features.map((f) => ({
        key: f.key,
        name: f.name,
        featureKind: f.featureKind,
        requirementKeys: f.requirementKeys,
        estimate: estimateFor(f.rawHours, f.featureKind, band, lessons),
      })),
    });
    await act.say(
      `Wrote ${written.requirementIds.length} requirements and ${written.featureIds.length} features`,
    );
    return {
      outputIds: [...written.requirementIds, ...written.featureIds, ...written.estimateIds],
      summary: output.summary,
    };
  },
};
