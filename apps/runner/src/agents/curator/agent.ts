// The Curator (agent-prompts.md section 9): writes the case study and one anonymous lesson per
// featureKind after the project closes (write_case_study, agency graph).
import { loadPrompt, type Agent, type Recall } from "../../agent";
import { ToolRejected, type ToolIn } from "../../mcp-client";
import { CuratorOutput } from "./output";

// The gateway's anonymity guard uses the same patterns (apps/gateway/src/mcp/guards/anonymity.ts).
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const URL_ = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Act step 2: emails and URLs out first (a name inside one would break it up), then every name,
 * longest first, as a whole word in any case, becomes "the client".
 */
export function anonymise(text: string, names: string[]): string {
  let out = text.replace(EMAIL, "").replace(URL_, "");
  const known = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 2))].sort(
    (a, b) => b.length - a.length,
  );
  for (const name of known) {
    out = out.replace(new RegExp(`(?<!\\w)${escape(name)}(?!\\w)`, "gi"), "the client");
  }
  return out;
}

/** One lesson per featureKind of the project's features, and none for another kind. */
export function checkLessons(output: CuratorOutput, recall: Recall): string[] {
  const kinds = new Set((recall.context.features ?? []).map((f) => f.featureKind));
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const { featureKind } of output.lessons) {
    if (seen.has(featureKind)) errors.push(`lessons: ${featureKind} has more than one lesson`);
    else if (!kinds.has(featureKind)) {
      errors.push(`lessons: ${featureKind} is not a featureKind of the project`);
    }
    seen.add(featureKind);
  }
  for (const kind of kinds) if (!seen.has(kind)) errors.push(`lessons: ${kind} has no lesson`);
  return errors;
}

type CaseStudyIn = ToolIn<"write_case_study">;

/**
 * Removes `match` from every text (the retry after an anonymity rejection), in any case: the guard
 * names the Entity as stored, not as the text wrote it.
 */
function without(input: CaseStudyIn, match: string): CaseStudyIn {
  const cut = (s: string) => s.replace(new RegExp(escape(match), "gi"), "");
  return {
    ...input,
    caseStudy: { ...input.caseStudy, lessonsLearned: cut(input.caseStudy.lessonsLearned) },
    lessons: input.lessons.map((l) => ({ ...l, text: cut(l.text) })),
  };
}

export const curator: Agent<CuratorOutput> = {
  id: "curator",
  kinds: ["curator"],
  tier: "deep",
  task: "Write the lessons learned and one lesson per feature kind.",
  prompt: await loadPrompt(import.meta.url, "Curator"),
  output: CuratorOutput,
  handoff: [], // stage-machine.md section 3: write_case_study, complete_item
  select: (recall) => ({
    metrics: recall.context.metrics,
    features: recall.context.features ?? [],
    entities: recall.context.entities ?? [],
    handoffs: recall.context.handoffs ?? [],
  }),
  check: checkLessons,
  async act(output, recall, act) {
    // ponytail: a project closes after Discovery, so clarity is set; "high" is clarityBand(0).
    const clarityBand = recall.project.clarity?.band ?? "high";
    const names = [
      recall.project.clientName,
      ...(recall.context.entities ?? []).flatMap((e) => [e.name, ...e.aliases]),
    ];
    const clean = (text: string, max: number) => anonymise(text, names).trim().slice(0, max);
    const input: CaseStudyIn = {
      itemId: recall.item.id,
      caseStudy: {
        metrics: recall.context.metrics!,
        lessonsLearned: clean(output.lessonsLearned, 1500),
      },
      records: (recall.context.features ?? []).map((f) => ({
        featureKind: f.featureKind,
        clarityBand,
        estimate: f.estimate.hours,
        raw: f.estimate.rawHours,
        actual: f.actualHours ?? 0, // route 29 sets every feature's actual hours
      })),
      lessons: output.lessons.map((l) => ({
        featureKind: l.featureKind,
        clarityBand,
        text: clean(l.text, 300),
      })),
    };
    let written;
    try {
      written = await act.call("write_case_study", input);
    } catch (e) {
      const match =
        e instanceof ToolRejected && e.rejection.guard === "anonymity"
          ? e.rejection.details?.match
          : undefined;
      if (typeof match !== "string" || !match) throw e;
      written = await act.call("write_case_study", without(input, match));
    }
    const summary = `Case study with ${input.lessons.length} lessons (${clarityBand} clarity)`;
    await act.say(summary);
    return { outputIds: [written.caseStudyId, ...written.lessonIds], summary };
  },
};
