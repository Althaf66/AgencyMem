// Task 2.5, Done when (end to end): fixture set A uploaded, the real Intake agent loop over the real
// gateway and FalkorDB, with the model replaced by the recorded replies in tests/recordings.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProjectInfo } from "@agencymem/contracts";
import { intake } from "../../apps/runner/src/agents/intake/agent";
import { startHarness, ui, type Harness } from "./harness";

// Built at run time, so this file holds no Cypher string literal (AGENTS.md rule 4).
const q = (...parts: string[]) => parts.join(" ");

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.stop());

describe("Done when: every fact has a SOURCED_FROM edge (set A through the Intake agent)", () => {
  it("turns the three notes into sourced facts, then T3 opens discovery", async () => {
    const project = await h.project("A");
    await h.run(intake, "intake-A.json", project.id, 3);

    // Every fact has at least one SOURCED_FROM edge, and none is missing.
    const facts = await h.rows(
      project.id,
      q(
        "MATCH",
        "(f:Fact)",
        "OPTIONAL MATCH",
        "(f)-[:SOURCED_FROM]->(e:Episode)-[:PART_OF]->(d:Document)",
        "RETURN",
        "f.id, count(e), collect(DISTINCT d.name)",
      ),
    );
    expect(facts).toHaveLength(24 + 18 + 6);
    for (const [, sources, documents] of facts as [string, number, string[]][]) {
      expect(sources).toBeGreaterThanOrEqual(1);
      expect(documents).toHaveLength(1); // a fact cites episodes of its own document
    }

    // One Entity per key across the three documents; the items are done with their handoffs.
    expect(
      await h.rows(project.id, q("MATCH", "(n:Entity {key: 'clinic'})", "RETURN", "count(n)")),
    ).toEqual([[1]]);
    expect(
      await h.rows(
        project.id,
        q("MATCH", "(w:WorkItem)", "RETURN", "w.kind, w.status, w.handoff ORDER BY w.handoff"),
      ),
    ).toEqual([
      ["intake", "done", "18 facts from client-summary.docx"],
      ["intake", "done", "24 facts from kickoff-notes.pdf"],
      ["intake", "done", "6 facts from whatsapp-chat.txt"],
      ["discovery", "open", null],
    ]);
    const info = await fetch(`${h.base}/api/projects/${project.id}`, { headers: ui });
    expect(((await info.json()) as { project: ProjectInfo }).project.stage).toBe("discovery");
  });
});
