import { describe, expect, it } from "vitest";
import type { Recall } from "../../agent";
import { architect, checkDesign } from "./agent";
import type { ArchitectOutput } from "./output";

const recall = (kind: "architect" | "architect_revise", note: string | null = null) =>
  ({
    item: { id: "01JA0000000000000000000001", kind, note },
    project: { designVersion: 3 },
    context: {
      requirements: [{ key: "REQ-01" }, { key: "REQ-02" }],
      features: [{ key: "FEAT-01" }],
      design: [{ key: "CMP-01" }],
      docSections: [],
      facts: [],
    },
  }) as unknown as Recall;

const output = (over: Partial<ArchitectOutput> = {}): ArchitectOutput => ({
  nodes: [
    {
      label: "Endpoint",
      key: "EP-01",
      name: "Book a slot",
      body: "Body: doctorId, slotStart.",
      method: "POST",
      path: "/api/bookings",
      requirementKeys: ["REQ-01"],
    },
  ],
  sections: [
    {
      doc: "tdd",
      order: 3,
      title: "API endpoints",
      body: "One endpoint.",
      renders: ["EP-01", "CMP-01"],
    },
    { doc: "prd", order: 0, title: "Summary", body: "One feature.", renders: ["FEAT-01"] },
  ],
  ...over,
});

describe("Architect agent (agent-prompts.md section 5)", () => {
  it("has the preamble, its rules, the conventions and 8,000 tokens", () => {
    expect(architect.prompt).toMatch(/^You are the Architect agent of AgencyMem/);
    expect(architect.prompt).toMatch(/DEC-01, CMP-01, SCR-01, ENT-01, EP-01, RSK-01/);
    expect(architect.kinds).toEqual(["architect", "architect_revise"]);
    expect(architect.handoff).toEqual(["architect"]);
    expect(architect.maxTokens).toBe(8000);
    const context = architect.select(recall("architect")) as { conventions: string };
    expect(context.conventions).toMatch(/data-testid/);
  });

  it("writes the design, or revises it with the note", () => {
    const task = architect.task as (r: Recall) => string;
    expect(task(recall("architect"))).toBe("Write the design and the three documents.");
    expect(task(recall("architect_revise", "Say the clinic name first."))).toBe(
      "Change the design and the sections this note asks for: Say the clinic name first.",
    );
  });

  it("asks for a repair on an unknown requirement or a section that renders an unknown key", () => {
    expect(checkDesign(output(), recall("architect"))).toEqual([]);
    expect(
      checkDesign(
        output({
          nodes: [{ ...output().nodes[0]!, requirementKeys: ["REQ-09"] }],
          sections: [
            { doc: "prd", order: 1, title: "Users", body: "x", renders: ["REQ-01", "SCR-07"] },
          ],
        }),
        recall("architect"),
      ),
    ).toEqual([
      "nodes.0.requirementKeys: REQ-09 is not a requirement in CONTEXT",
      "sections.0.renders: SCR-07 is not a requirement, feature or design node",
    ]);
  });

  it("names the stale sections in a revision, and asks again when one is left out", () => {
    const flagged = recall("architect_revise", "The phone number is now 0491 570 999.");
    const section = (doc: "prd" | "tdd", order: number, title: string, stale: boolean) => ({
      id: `S-${doc}-${order}`,
      doc,
      order,
      title,
      body: "Old text.",
      stale,
      renders: ["REQ-01"],
    });
    (flagged.context as { docSections: unknown[] }).docSections = [
      section("prd", 1, "Users and goals", true),
      section("tdd", 3, "API endpoints", true),
      section("prd", 0, "Summary", false),
    ];
    const task = architect.task as (r: Recall) => string;
    expect(task(flagged)).toBe(
      "Change the design and the sections this note asks for: The phone number is now 0491 570 999." +
        " Also rewrite these stale sections: prd 1 Users and goals; tdd 3 API endpoints.",
    );
    expect(checkDesign(output(), flagged)).toEqual([
      'sections: prd 1 "Users and goals" is stale; return it rewritten',
    ]);
    const users = { doc: "prd", order: 1, title: "Users", body: "New.", renders: ["REQ-01"] };
    const all = output({ sections: [...output().sections, users as never] });
    expect(checkDesign(all, flagged)).toEqual([]);
  });

  it("writes with write_design at the current design version", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const result = await architect.act(output(), recall("architect"), {
      call: (async (name: string, input: Record<string, unknown>) => {
        calls.push([name, input]);
        return { designVersion: 4, nodeIds: ["N1"], sectionIds: ["S1", "S2"] };
      }) as never,
      say: async () => {},
    });
    expect(calls).toEqual([
      ["write_design", { itemId: recall("architect").item.id, baseVersion: 3, ...output() }],
    ]);
    expect(result).toEqual({
      outputIds: ["N1", "S1", "S2"],
      summary: "Design version 4: 1 design node and 2 sections",
    });
  });
});
