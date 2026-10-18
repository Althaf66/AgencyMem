import { describe, expect, it } from "vitest";
import type { Recall } from "../../agent";
import { ask, checkAnswer } from "./ask";

const [F1, F2] = ["01JA00000000000000000000F1", "01JA00000000000000000000F2"];
const recall = {
  item: { id: "01JA0000000000000000000001" },
  context: {
    ask: { question: "When does the shop open?", earlier: [] },
    facts: [{ id: F1, statement: "The shop opens at 9.", episodeIds: [] }],
  },
} as unknown as Recall;

describe("Discovery agent, ask kind", () => {
  it("is a second discovery loop that hands off its answer", () => {
    expect(ask.prompt).toMatch(/^You are the Discovery agent of AgencyMem/);
    expect(ask.prompt).toMatch(/Do not guess\./);
    expect([ask.id, ask.worker, ask.kinds, ask.handoff]).toEqual([
      "discovery",
      "discovery-2",
      ["ask"],
      ["ask"],
    ]);
    expect(typeof ask.task === "function" && ask.task(recall)).toBe(
      "Answer this question: When does the shop open?",
    );
  });

  it("asks for a repair when a cited fact is not a current fact", () => {
    expect(checkAnswer({ answer: "At 9.", factIds: [F1] }, recall)).toEqual([]);
    expect(checkAnswer({ answer: "At 9.", factIds: [F1, F2] }, recall)).toEqual([
      `factIds: ${F2} is not a current fact in CONTEXT`,
    ]);
  });

  it("returns the answer as the handoff and each cited fact once", async () => {
    const said: string[] = [];
    const result = await ask.act({ answer: "At 9.", factIds: [F1, F1] }, recall, {
      call: (() => Promise.reject(new Error("no tool call"))) as never,
      say: async (text) => void said.push(text),
    });
    expect(result).toEqual({ outputIds: [F1], summary: "At 9." });
    expect(said).toEqual(["Answered from 1 facts"]);
  });
});
