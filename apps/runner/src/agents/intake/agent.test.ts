import { describe, expect, it } from "vitest";
import type { Recall } from "../../agent";
import { checkFacts, intake } from "./agent";

const E1 = "01JA00000000000000000000E1";
const F1 = "01JA00000000000000000000F1";
const recall = {
  item: { id: "01JA0000000000000000000001" },
  context: {
    episodes: [{ id: E1, documentName: "kickoff-notes.pdf", page: 1, lineStart: 4, lineEnd: 6 }],
    entities: [],
  },
} as unknown as Recall;
const fact = (over: Record<string, unknown> = {}) => ({
  statement: "An appointment slot is 20 minutes long.",
  subject: "appointment-slot",
  attribute: "length_minutes",
  value: "20",
  entity: { key: "appointment-slot", name: "Appointment slot", aliases: ["slot"] },
  episodeIds: [E1],
  ...over,
});

describe("Intake agent", () => {
  it("has the shared preamble and its own rules in its prompt", () => {
    expect(intake.prompt).toMatch(/^You are the Intake agent of AgencyMem/);
    expect(intake.prompt).toMatch(/At most 60 facts for one document\./);
  });

  it("asks for a repair when there are no facts, an unknown episode, or a wrong subject", () => {
    expect(checkFacts({ facts: [fact()] }, recall)).toEqual([]);
    expect(checkFacts({ facts: [] }, recall)).toEqual(["no facts found"]);
    expect(
      checkFacts({ facts: [fact({ episodeIds: ["01JA00000000000000000000E9"] })] }, recall),
    ).toEqual(["facts.0.episodeIds: 01JA00000000000000000000E9 is not an episode in CONTEXT"]);
    expect(checkFacts({ facts: [fact({ subject: "slot" })] }, recall)).toEqual([
      "facts.0.subject must be the same key as entity.key (appointment-slot)",
    ]);
  });

  it("writes the facts with write_fact and hands off <n> facts from <document>", async () => {
    const calls: unknown[] = [];
    const said: string[] = [];
    const result = await intake.act({ facts: [fact()] }, recall, {
      call: (async (name: string, input: unknown) => {
        calls.push([name, input]);
        return { factIds: ["F1"], entityIds: ["N1"], superseded: [] };
      }) as never,
      say: async (text) => {
        said.push(text);
      },
    });
    expect(calls).toEqual([["write_fact", { itemId: recall.item.id, facts: [fact()] }]]);
    expect(said).toEqual(["Wrote 1 facts"]);
    expect(result).toEqual({ outputIds: ["F1", "N1"], summary: "1 facts from kickoff-notes.pdf" });
  });

  it("claims answers too, and reads the answered question and its facts for them", () => {
    expect(intake.kinds).toEqual(["intake", "intake_answer"]);
    expect(intake.handoff).toEqual(["intake"]);
    const answer = {
      ...recall,
      context: { ...recall.context, questions: [{ id: "Q1" }], facts: [{ id: F1 }] },
    } as unknown as Recall;
    expect(intake.select(answer)).toEqual({
      episodes: recall.context.episodes,
      entities: [],
      questions: [{ id: "Q1" }],
      facts: [{ id: F1 }],
    });
    expect(intake.select(recall)).toEqual({ episodes: recall.context.episodes, entities: [] });
  });

  it("asks for a repair when replacesFactId is not a fact in CONTEXT", () => {
    const answer = {
      ...recall,
      context: { ...recall.context, facts: [{ id: F1 }] },
    } as unknown as Recall;
    expect(checkFacts({ facts: [fact({ replacesFactId: F1 })] }, answer)).toEqual([]);
    expect(checkFacts({ facts: [fact({ replacesFactId: E1 })] }, answer)).toEqual([
      `facts.0.replacesFactId: ${E1} is not a fact in CONTEXT`,
    ]);
    const ended = {
      ...recall,
      context: { ...recall.context, facts: [{ id: F1, validTo: 1, replacedBy: "F2" }] },
    } as unknown as Recall;
    expect(checkFacts({ facts: [fact({ replacesFactId: F1 })] }, ended)).toEqual([
      `facts.0.replacesFactId: ${F1} is already replaced by F2; replace that one`,
    ]);
  });
});
