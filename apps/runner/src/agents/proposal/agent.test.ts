import { describe, expect, it } from "vitest";
import type { Recall } from "../../agent";
import { adjust, checkProposal, estimateFor, proposal } from "./agent";
import type { ProposalOutput } from "./output";

const [F1, F2] = ["01JA00000000000000000000F1", "01JA00000000000000000000F2"];
const [L1, L2, L3] = [
  "01JA00000000000000000000L1",
  "01JA00000000000000000000L2",
  "01JA00000000000000000000L3",
];
const lesson = (id: string, over: Record<string, unknown>) => ({
  id,
  featureKind: "calendar" as const,
  clarityBand: "low" as const,
  ratio: 1.91,
  n: 1,
  text: "Calendars took longer than planned.",
  ...over,
});

describe("adjust (agent-prompts.md section 4, Estimate method)", () => {
  it("uses the lesson of the same featureKind and clarityBand", () => {
    const lessons = [lesson(L1, {}), lesson(L2, { clarityBand: "medium", ratio: 1.2 })];
    const exact = adjust(7, "calendar", "low", lessons);
    expect(exact.ratio).toBe(1.91);
    expect(exact.used.map((l) => l.id)).toEqual([L1]);
    expect(exact.basis).toBe("raw 7 h × 1.91 (lesson low, n=1)");
    expect(estimateFor(7, "calendar", "low", lessons)).toEqual({
      rawHours: 7,
      hours: 13.5,
      basis: "raw 7 h × 1.91 (lesson low, n=1) = 13.5 h",
      lessonIds: [L1],
    });
  });

  it("falls back to every lesson of the featureKind, weighted by n (C3)", () => {
    const lessons = [
      lesson(L1, { ratio: 2, n: 1 }),
      lesson(L2, { clarityBand: "high", ratio: 1.5, n: 3 }),
      lesson(L3, { featureKind: "form", clarityBand: "medium", ratio: 9, n: 5 }),
    ];
    const fallback = adjust(4, "calendar", "medium", lessons);
    expect(fallback.ratio).toBeCloseTo((2 * 1 + 1.5 * 3) / 4);
    expect(fallback.used.map((l) => l.id)).toEqual([L1, L2]);
    expect(fallback.basis).toBe("raw 4 h × 1.63 (calendar lessons, any band, n=4)");
    // 4 × 1.625 = 6.5
    expect(estimateFor(4, "calendar", "medium", lessons)).toEqual({
      rawHours: 4,
      hours: 6.5,
      basis: "raw 4 h × 1.63 (calendar lessons, any band, n=4) = 6.5 h",
      lessonIds: [L1, L2],
    });
  });

  it("says 'no lesson' when no lesson has the featureKind", () => {
    expect(estimateFor(7, "form", "low", [lesson(L1, {})])).toEqual({
      rawHours: 7,
      hours: 7,
      basis: "raw 7 h, no lesson = 7 h",
      lessonIds: [],
    });
  });

  it("rounds to the nearest 0.5 hour", () => {
    expect(estimateFor(3, "calendar", "low", [lesson(L1, { ratio: 1.1 })]).hours).toBe(3.5); // 3.3
    expect(estimateFor(3, "calendar", "low", [lesson(L1, { ratio: 1.05 })]).hours).toBe(3); // 3.15
  });

  it("matches no exact lesson without a clarity band, so only the fallback applies", () => {
    expect(adjust(7, "calendar", null, [lesson(L1, {})]).basis).toBe(
      "raw 7 h × 1.91 (calendar lessons, any band, n=1)",
    );
  });
});

const recall = {
  item: { id: "01JA0000000000000000000001" },
  project: { productVersion: 0, clarity: { density: 7, band: "low" } },
  context: {
    facts: [{ id: F1 }, { id: F2 }],
    lessons: [lesson(L1, {})],
  },
} as unknown as Recall;

const feature = (key: string, over: Record<string, unknown> = {}) => ({
  key,
  name: "Slot calendar",
  featureKind: "calendar" as const,
  requirementKeys: ["REQ-01"],
  parts: { data: 1, api: 2, ui: 3, tests: 1 },
  rawHours: 7,
  ...over,
});
const output = (over: Partial<ProposalOutput> = {}): ProposalOutput => ({
  summary: "Four features for the clinic booking site.",
  requirements: [
    {
      key: "REQ-01",
      text: "A patient can book one free 20-minute slot.",
      priority: "must",
      factIds: [F1],
    },
    { key: "REQ-02", text: "A patient can cancel a booking.", priority: "should", factIds: [F2] },
  ],
  features: [feature("FEAT-01"), feature("FEAT-02"), feature("FEAT-03"), feature("FEAT-04")],
  ...over,
});

describe("Proposal agent", () => {
  it("has the shared preamble and its own rules in its prompt", () => {
    expect(proposal.prompt).toMatch(/^You are the Proposal agent of AgencyMem/);
    expect(proposal.prompt).toMatch(/4 to 8 features/);
    expect(proposal.kinds).toEqual(["proposal"]);
  });

  it("asks for a repair on a wrong sum, an unknown fact or key, a repeated key, a bad count", () => {
    expect(checkProposal(output(), recall)).toEqual([]);
    expect(
      checkProposal(
        output({
          features: [
            feature("FEAT-01", { rawHours: 8 }),
            feature("FEAT-02", { rawHours: 25, parts: { data: 5, api: 10, ui: 10, tests: 0 } }),
            feature("FEAT-03", { requirementKeys: ["REQ-09"] }),
            feature("FEAT-03"),
          ],
        }),
        recall,
      ),
    ).toEqual([
      "features.0: the parts sum to 7, not rawHours 8",
      "features.1.rawHours: 25 is outside 1 to 24",
      "features.2.requirementKeys: REQ-09 is not a requirement in the output",
      "features.3.key: FEAT-03 is used twice",
    ]);
    expect(
      checkProposal(
        output({
          requirements: [
            {
              key: "REQ-01",
              text: "A patient can book.",
              priority: "must",
              factIds: ["01JA00000000000000000000F9"],
            },
            { key: "REQ-01", text: "A patient can cancel.", priority: "must", factIds: [F2] },
          ],
          features: [feature("FEAT-01")],
        }),
        recall,
      ),
    ).toEqual([
      "requirements.0.factIds: 01JA00000000000000000000F9 is not a current fact in CONTEXT",
      "requirements.1.key: REQ-01 is used twice",
      "features: 1 features; write 4 to 8",
    ]);
  });

  it("writes the product with the lesson-adjusted estimates and hands off the summary", async () => {
    const calls: [string, unknown][] = [];
    const result = await proposal.act(output(), recall, {
      call: (async (name: string, input: unknown) => {
        calls.push([name, input]);
        return {
          productVersion: 1,
          requirementIds: ["R1", "R2"],
          featureIds: ["FE1"],
          estimateIds: ["ES1"],
          ended: [],
        };
      }) as never,
      say: async () => {},
    });
    expect(calls).toHaveLength(1);
    const [name, input] = calls[0]! as [string, Record<string, unknown>];
    expect(name).toBe("write_product");
    expect(input.baseVersion).toBe(0);
    expect(input.requirements).toEqual(output().requirements);
    expect((input.features as unknown[])[0]).toEqual({
      key: "FEAT-01",
      name: "Slot calendar",
      featureKind: "calendar",
      requirementKeys: ["REQ-01"],
      estimate: {
        rawHours: 7,
        hours: 13.5,
        basis: "raw 7 h × 1.91 (lesson low, n=1) = 13.5 h",
        lessonIds: [L1],
      },
    });
    expect(result).toEqual({
      outputIds: ["R1", "R2", "FE1", "ES1"],
      summary: "Four features for the clinic booking site.",
    });
  });
});
