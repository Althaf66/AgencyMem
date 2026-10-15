import { describe, expect, it } from "vitest";
import type { Recall } from "../../agent";
import { checkCards, planner } from "./agent";
import type { PlannerOutput } from "./output";

const recallOf = (kind: string, extra: Record<string, unknown> = {}) =>
  ({
    item: { id: "01JA0000000000000000000001", kind, note: null },
    project: { designVersion: 2 },
    context: {
      requirements: [{ key: "REQ-01" }, { key: "REQ-02" }],
      features: [{ key: "FEAT-01" }],
      design: [{ key: "EP-01" }, { key: "SCR-01" }],
      docSections: [{ doc: "plan", order: 1, title: "Build order" }],
      ...extra,
    },
  }) as unknown as Recall;
const replan = recallOf("replan", {
  changeRequest: { id: "C1", text: "Slots are 30 minutes." },
  facts: [{ id: "F1" }],
  tasks: [
    { key: "CARD-02", version: 4 },
    { key: "CARD-03", version: 2 },
  ],
});
const recall = recallOf("planner");

type Card = PlannerOutput["cards"][number];
const card = (n: number, over: Partial<Card> = {}): Card => ({
  key: `CARD-0${n}`,
  title: `Card ${n}`,
  description: "Builds it.",
  lane: n === 1 ? "Backend" : "Frontend",
  order: n * 10,
  requirementKey: n === 1 ? "REQ-01" : "REQ-02",
  designKeys: n === 1 ? ["EP-01"] : ["SCR-01"],
  dependsOn: n === 1 ? [] : ["CARD-01"],
  criteria: [{ key: `AC-0${n}-1`, text: "Given, when, then.", testIds: ["book-submit"] }],
  ...over,
});

describe("Planner agent (agent-prompts.md section 6)", () => {
  it("has the preamble, its rules, the reserved data-testid names and 8,000 tokens", () => {
    expect(planner.prompt).toMatch(/^You are the Planner agent of AgencyMem/);
    expect(planner.prompt).toMatch(/AC-<card number>-<n>/);
    expect(planner.prompt).toMatch(/booking-lookup-submit/);
    expect(planner.kinds).toEqual(["planner", "replan"]);
    expect(planner.handoff).toEqual(["planner"]);
    expect(planner.maxTokens).toBe(8000);
    const task = planner.task as (r: Recall) => string;
    expect(task(recall)).toBe("Write the cards.");
    expect(task(replan)).toBe("Update the cards in Rework for this change request.");
  });

  it("sends the product, the design and the plan's sections", () => {
    expect(planner.select(recall)).toEqual({
      requirements: recall.context.requirements,
      features: recall.context.features,
      design: recall.context.design,
      docSections: recall.context.docSections,
    });
  });

  it("asks for a repair on unknown keys, a cycle, a criterion of another card, or too many cards", () => {
    expect(checkCards({ cards: [card(1), card(2)] }, recall)).toEqual([]);
    expect(
      checkCards(
        {
          cards: [
            card(1, { requirementKey: "REQ-09", designKeys: ["CMP-09"], dependsOn: ["CARD-02"] }),
            card(2, { dependsOn: ["CARD-01", "CARD-07"] }),
            card(3, { criteria: [{ key: "AC-04-1", text: "x", testIds: ["a"] }] }),
          ],
        },
        recall,
      ),
    ).toEqual([
      "cards.0.requirementKey: REQ-09 is not a requirement in CONTEXT",
      "cards.0.designKeys: CMP-09 is not a design node in CONTEXT",
      "cards.1.dependsOn: CARD-07 is not a card in the output",
      "cards.2.criteria.0.key: AC-04-1 does not belong to CARD-03 (use AC-03-<n>)",
      "cards.dependsOn: the cards form a cycle CARD-01 -> CARD-02 -> CARD-01",
    ]);
    const eleven = Array.from({ length: 11 }, (_, i) =>
      card(1, {
        key: `CARD-${String(i + 1).padStart(2, "0")}`,
        criteria: [{ key: `AC-${String(i + 1).padStart(2, "0")}-1`, text: "x", testIds: ["a"] }],
      }),
    );
    expect(checkCards({ cards: eleven }, recall)).toEqual([
      "cards: 11 cards is more than 10; merge cards",
    ]);
  });

  it("writes the cards in create mode", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const output = { cards: [card(1), card(2)] };
    const result = await planner.act(output, recall, {
      call: (async (name: string, input: Record<string, unknown>) => {
        calls.push([name, input]);
        return { taskIds: ["T1", "T2"], criterionIds: ["C1", "C2"] };
      }) as never,
      say: async () => {},
    });
    expect(calls).toEqual([
      ["write_cards", { itemId: recall.item.id, mode: "create", cards: output.cards }],
    ]);
    expect(result).toEqual({
      outputIds: ["T1", "T2", "C1", "C2"],
      summary: "2 cards in Backlog with 2 acceptance criteria",
    });
  });

  it("updates the Rework cards of a replan with their versions from CONTEXT", async () => {
    expect(planner.select(replan)).toMatchObject({
      changeRequest: { id: "C1" },
      facts: [{ id: "F1" }],
      tasks: [{ key: "CARD-02" }, { key: "CARD-03" }],
    });
    // A replan card may depend on a card outside CONTEXT (one that is not in Rework).
    expect(checkCards({ cards: [card(2, { dependsOn: ["CARD-01"] })] }, replan)).toEqual([]);
    expect(checkCards({ cards: [card(4)] }, replan)).toEqual([
      "cards.0.key: CARD-04 is not a card in Rework in CONTEXT.tasks",
    ]);
    const calls: [string, Record<string, unknown>][] = [];
    const result = await planner.act({ cards: [card(2)] }, replan, {
      call: (async (name: string, input: Record<string, unknown>) => {
        calls.push([name, input]);
        return { taskIds: ["T2"], criterionIds: ["C2"] };
      }) as never,
      say: async () => {},
    });
    expect(calls).toEqual([
      [
        "write_cards",
        { itemId: replan.item.id, mode: "update", cards: [{ ...card(2), version: 4 }] },
      ],
    ]);
    expect(result.summary).toBe("1 card revised in Rework with 1 acceptance criterion");
  });
});
