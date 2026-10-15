import { describe, expect, it } from "vitest";
import type { Recall } from "../../agent";
import { changeRequest, checkChanges } from "./change-request";

const [F1, F2, F3, NEW] = [
  "01JA00000000000000000000F1",
  "01JA00000000000000000000F2",
  "01JA00000000000000000000F3",
  "01JA0000000000000000000NF1",
];
const CR = "01JA00000000000000000000C1";
const recall = {
  item: { id: "01JA0000000000000000000001", subjectId: CR, note: null },
  project: { productVersion: 2 },
  context: {
    changeRequest: { id: CR, text: "Slots are 30 minutes now.", episodeId: "E", status: "open" },
    facts: [{ id: F1 }, { id: F2 }, { id: F3 }],
    requirements: [
      {
        id: "R1",
        key: "REQ-01",
        text: "A patient can book one 20-minute slot.",
        priority: "must",
        factIds: [F1, F2],
        version: 2,
      },
      {
        id: "R2",
        key: "REQ-02",
        text: "A patient can cancel.",
        priority: "should",
        factIds: [F3],
        version: 2,
      },
    ],
    features: [
      {
        id: "X1",
        key: "FEAT-01",
        name: "Booking",
        featureKind: "form",
        requirementKeys: ["REQ-01", "REQ-02"],
        estimate: {
          id: "E1",
          hours: 7,
          rawHours: 7,
          basis: "raw 7 h, no lesson = 7 h",
          lessonIds: [],
        },
        actualHours: null,
      },
    ],
  },
} as unknown as Recall;

const change = { oldFactId: F1, statement: "An appointment slot is 30 minutes long.", value: "30" };

describe("Proposal agent, change_request kind (agent-prompts.md section 4)", () => {
  it("claims change_request items with its own prompt, TASK line and worker", () => {
    expect(changeRequest.kinds).toEqual(["change_request"]);
    expect(changeRequest.id).toBe("proposal");
    expect(changeRequest.worker).toBe("proposal-2");
    expect(changeRequest.task).toBe("Apply this change request to the facts.");
    expect(changeRequest.prompt).toMatch(/^You are the Proposal agent of AgencyMem/);
    expect(changeRequest.prompt).toMatch(/needs_scope/);
  });

  it("asks for a repair on an unknown fact or requirement, or needs_scope with changes", () => {
    expect(checkChanges({ changes: [change], requirementUpdates: [] }, recall)).toEqual([]);
    expect(
      checkChanges(
        {
          changes: [{ ...change, oldFactId: "01JA00000000000000000000F9" }],
          outcome: "needs_scope",
          requirementUpdates: [{ key: "REQ-09", text: "x" }],
        },
        recall,
      ),
    ).toEqual([
      "changes.0.oldFactId: 01JA00000000000000000000F9 is not a current fact in CONTEXT",
      "requirementUpdates.0.key: REQ-09 is not a requirement in CONTEXT",
      "outcome: needs_scope comes with no changes",
    ]);
  });

  const run = async (output: Parameters<typeof changeRequest.act>[0]) => {
    const calls: [string, Record<string, unknown>][] = [];
    const result = await changeRequest.act(output, recall, {
      call: (async (name: string, input: Record<string, unknown>) => {
        calls.push([name, input]);
        return name === "record_change_request"
          ? {
              newFactIds: [NEW],
              flagged: { taskIds: ["T1"], docSectionIds: [] },
              crStatus: "applied",
            }
          : {
              productVersion: 3,
              requirementIds: ["R1", "R2"],
              featureIds: ["X1"],
              estimateIds: ["E1"],
              ended: [],
            };
      }) as never,
      say: async () => {},
    });
    return { calls, result };
  };

  it("records the changes; with no requirement update it writes no product", async () => {
    const { calls, result } = await run({ changes: [change], requirementUpdates: [] });
    expect(calls).toEqual([
      ["record_change_request", { itemId: recall.item.id, crId: CR, changes: [change] }],
    ]);
    expect(result).toEqual({
      outputIds: [NEW],
      summary: "1 fact changed; flagged 1 card and 0 sections",
    });
  });

  it("then writes the product with the new texts, the new facts and the same estimates", async () => {
    const { calls } = await run({
      changes: [change],
      requirementUpdates: [{ key: "REQ-01", text: "A patient can book one 30-minute slot." }],
    });
    expect(calls[1]).toEqual([
      "write_product",
      {
        itemId: recall.item.id,
        baseVersion: 2,
        requirements: [
          {
            key: "REQ-01",
            text: "A patient can book one 30-minute slot.",
            priority: "must",
            factIds: [NEW, F2],
          },
          { key: "REQ-02", text: "A patient can cancel.", priority: "should", factIds: [F3] },
        ],
        features: [
          {
            key: "FEAT-01",
            name: "Booking",
            featureKind: "form",
            requirementKeys: ["REQ-01", "REQ-02"],
            estimate: { rawHours: 7, hours: 7, basis: "raw 7 h, no lesson = 7 h", lessonIds: [] },
          },
        ],
      },
    ]);
  });

  it("passes needs_scope on with no changes", async () => {
    const { calls } = await run({ changes: [], outcome: "needs_scope", requirementUpdates: [] });
    expect(calls).toEqual([
      [
        "record_change_request",
        { itemId: recall.item.id, crId: CR, changes: [], outcome: "needs_scope" },
      ],
    ]);
  });
});
