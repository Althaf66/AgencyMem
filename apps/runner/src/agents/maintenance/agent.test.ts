import { describe, expect, it } from "vitest";
import type { Recall } from "../../agent";
import { checkFix, maintenance } from "./agent";
import type { MaintenanceOutput } from "./output";

const SHA = "c".repeat(40);
const recall = {
  item: { id: "01JA00000000000000000000W1", kind: "maintenance", note: null },
  project: {},
  context: {
    defect: { reportEpisodeId: "01JA00000000000000000000E1", text: "A slot at 1:20 pm." },
    requirements: [{ key: "REQ-04" }],
    tasks: [
      { key: "CARD-03", criteria: [] },
      { key: "CARD-11", criteria: [] },
    ],
    codeChanges: [{ id: "01JA00000000000000000000C1", sha: SHA, taskKey: "CARD-03", linked: true }],
    design: [{ key: "EP-02" }],
  },
} as unknown as Recall;

const output = (over: Partial<MaintenanceOutput> = {}): MaintenanceOutput => ({
  title: "A slot is offered in the lunch break",
  severity: "high",
  requirementKey: "REQ-04",
  codeChangeSha: SHA,
  reasoning: "REQ-04 says no slots from 13:00 to 14:00; CARD-03 builds the slot list.",
  fix: {
    title: "Hide lunch slots",
    description: "No slot between 13:00 and 14:00.",
    lane: "Backend",
    designKeys: ["EP-02"],
    criteria: [
      { key: "AC-99-1", text: "Given a lunch break, when ..., then ...", testIds: ["slots-day"] },
      { key: "x", text: "Given ..., when ..., then ...", testIds: ["slots-slot-1320"] },
    ],
  },
  ...over,
});

describe("Maintenance agent (agent-prompts.md section 8)", () => {
  it("has the preamble, its rules, the TASK line, deep tier and no handoff", () => {
    expect(maintenance.prompt).toMatch(/^You are the Maintenance agent of AgencyMem/);
    expect(maintenance.prompt).toMatch(/severity: high when patients cannot book/);
    expect(maintenance.task).toBe(
      "Find the requirement this bug breaks and the code change that caused it. Propose a fix card.",
    );
    expect(maintenance.kinds).toEqual(["maintenance"]);
    expect(maintenance.tier).toBe("deep");
    expect(maintenance.handoff).toEqual([]);
  });

  it("sends the report, the product, the cards, the linked commits and the design", () => {
    expect(maintenance.select(recall)).toEqual({
      defect: recall.context.defect,
      requirements: recall.context.requirements,
      tasks: recall.context.tasks,
      codeChanges: recall.context.codeChanges,
      design: recall.context.design,
    });
  });

  it("names the requirement, commit and design keys that are not in CONTEXT", () => {
    expect(checkFix(output(), recall)).toEqual([]);
    expect(
      checkFix(
        output({
          requirementKey: "REQ-09",
          codeChangeSha: "d".repeat(40),
          fix: { ...output().fix, designKeys: ["SCR-07"] },
        }),
        recall,
      ),
    ).toEqual([
      "requirementKey: REQ-09 is not a requirement in CONTEXT",
      `codeChangeSha: ${"d".repeat(40)} is not a linked code change in CONTEXT`,
      "fix.designKeys: SCR-07 is not a design node in CONTEXT",
    ]);
  });

  it("reports the defect on the commit's id, then proposes CARD-<next> after the last card", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const result = await maintenance.act(output(), recall, {
      call: (async (name: string, input: Record<string, unknown>) => {
        calls.push([name, input]);
        return name === "report_defect"
          ? { defectId: "01JA00000000000000000000D1" }
          : { taskId: "01JA00000000000000000000T1", gateId: "01JA00000000000000000000G1" };
      }) as never,
      say: async () => {},
    });
    expect(calls).toEqual([
      [
        "report_defect",
        {
          itemId: recall.item.id,
          title: "A slot is offered in the lunch break",
          severity: "high",
          codeChangeId: "01JA00000000000000000000C1",
          reportEpisodeId: "01JA00000000000000000000E1",
          reasoning: output().reasoning,
        },
      ],
      [
        "propose_fix",
        {
          itemId: recall.item.id,
          defectId: "01JA00000000000000000000D1",
          card: {
            key: "CARD-12",
            title: "Hide lunch slots",
            description: "No slot between 13:00 and 14:00.",
            lane: "Backend",
            order: 120,
            requirementKey: "REQ-04",
            designKeys: ["EP-02"],
            dependsOn: [],
            // The model cannot know the key; the runner names the criteria after it.
            criteria: [
              { key: "AC-12-1", text: output().fix.criteria[0]!.text, testIds: ["slots-day"] },
              {
                key: "AC-12-2",
                text: output().fix.criteria[1]!.text,
                testIds: ["slots-slot-1320"],
              },
            ],
          },
        },
      ],
    ]);
    expect(result).toEqual({
      outputIds: [
        "01JA00000000000000000000D1",
        "01JA00000000000000000000T1",
        "01JA00000000000000000000G1",
      ],
      summary: "Defect on CARD-03 (high); fix card CARD-12 waits for G6",
    });
  });
});
