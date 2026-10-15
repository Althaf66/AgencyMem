import { describe, expect, it } from "vitest";
import type { Recall } from "../../agent";
import { checkQuestions, discovery } from "./agent";

const [E1, E2] = ["01JA00000000000000000000E1", "01JA00000000000000000000E2"];
const [F1, F2, F3] = [
  "01JA00000000000000000000F1",
  "01JA00000000000000000000F2",
  "01JA00000000000000000000F3",
];
const recall = {
  item: { id: "01JA0000000000000000000001" },
  context: {
    facts: [
      { id: F1, episodeIds: [E1] },
      { id: F2, episodeIds: [E2] },
      { id: F3, episodeIds: [E1] },
    ],
  },
} as unknown as Recall;
const question = (over: Record<string, unknown> = {}) => ({
  kind: "contradiction" as const,
  text: "Is an appointment slot 20 minutes or 30 minutes long?",
  recommended: "20 minutes.",
  reasoning: "The kickoff notes say 20 minutes.",
  assumption: "An appointment slot is 20 minutes long.",
  approach: "The calendar shows 20-minute slots.",
  factIds: [F1, F2],
  contradictionSummary: "Slot length is 20 minutes in the kickoff notes and 30 in the summary.",
  ...over,
});

describe("Discovery agent", () => {
  it("has the shared preamble and its own rules in its prompt", () => {
    expect(discovery.prompt).toMatch(/^You are the Discovery agent of AgencyMem/);
    expect(discovery.prompt).toMatch(/At most 20 questions\./);
  });

  it("asks for a repair: an unknown fact, a contradiction from one episode, a missing summary", () => {
    expect(checkQuestions({ questions: [question()] }, recall)).toEqual([]);
    expect(checkQuestions({ questions: [] }, recall)).toEqual([]); // zero questions is allowed
    expect(
      checkQuestions(
        { questions: [question({ factIds: [F1, "01JA00000000000000000000F9"] })] },
        recall,
      ),
    ).toEqual(["questions.0.factIds: 01JA00000000000000000000F9 is not a current fact in CONTEXT"]);
    expect(checkQuestions({ questions: [question({ factIds: [F1, F3] })] }, recall)).toEqual([
      "questions.0: a contradiction needs facts from at least 2 different episodes",
    ]);
    expect(checkQuestions({ questions: [question({ factIds: [F1, F1] })] }, recall)).toEqual([
      "questions.0: a contradiction needs at least 2 different facts",
    ]);
    expect(
      checkQuestions({ questions: [question({ contradictionSummary: undefined })] }, recall),
    ).toEqual(["questions.0.contradictionSummary is required for a contradiction"]);
  });

  it("writes the questions with write_question and hands off the counts", async () => {
    const calls: [string, unknown][] = [];
    const result = await discovery.act(
      {
        questions: [
          question(),
          question({ kind: "unclear", factIds: [F1], contradictionSummary: undefined }),
        ],
      },
      recall,
      {
        call: (async (name: string, input: unknown) => {
          calls.push([name, input]);
          return {
            questionIds: ["Q1", "Q2"],
            contradictionIds: ["C1"],
            assumptionIds: ["A1", "A2"],
          };
        }) as never,
        say: async () => {},
      },
    );
    const sent = calls[0]![1] as { questions: Record<string, unknown>[] };
    expect(calls[0]![0]).toBe("write_question");
    expect(sent.questions[0]).toMatchObject({
      contradiction: { summary: question().contradictionSummary },
    });
    expect(sent.questions[0]).not.toHaveProperty("contradictionSummary");
    expect(sent.questions[1]).not.toHaveProperty("contradiction");
    expect(result).toEqual({
      outputIds: ["Q1", "Q2", "C1", "A1", "A2"],
      summary: "1 contradictions, 0 open, 1 unclear",
    });
  });
});
