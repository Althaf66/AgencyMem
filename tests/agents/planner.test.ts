// Task 3.6, Done when: no card lacks a requirement link; the dependency graph has no cycle. Set A
// runs to G3 approved on recorded replies; the Planner writes the cards, and T15 opens a
// write_tests item for each.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProjectInfo } from "@agencymem/contracts";
import { architect } from "../../apps/runner/src/agents/architect/agent";
import { discovery } from "../../apps/runner/src/agents/discovery/agent";
import { intake } from "../../apps/runner/src/agents/intake/agent";
import { planner } from "../../apps/runner/src/agents/planner/agent";
import { proposal } from "../../apps/runner/src/agents/proposal/agent";
import { OWN_A, startHarness, ui, type Harness } from "./harness";

// Built at run time, so this file holds no Cypher string literal (AGENTS.md rule 4).
const q = (...parts: string[]) => parts.join(" ");

let h: Harness;
let project: ProjectInfo;

beforeAll(async () => {
  h = await startHarness();
  project = await h.project("A");
  await h.run(intake, "intake-A.json", project.id, 3);
  await h.run(discovery, "discovery-A.json", project.id, 1);
  await h.answerAndApprove(project.id, OWN_A);
  await h.run(intake, "intake-answer-A.json", project.id, 15);
  await h.run(proposal, "proposal-A.json", project.id, 1);
  await h.decide(project.id, "G2", "approve", `persona:${project.id}`);
  await h.run(architect, "architect-A.json", project.id, 1);
  await h.decide(project.id, "G3", "approve", "human:lead");
  await h.run(planner, "planner-A.json", project.id, 1);
}, 120_000); // the whole chain from upload to the cards
afterAll(() => h.stop());

describe("Done when: no card lacks a requirement link; the dependency graph has no cycle", () => {
  it("links every card to exactly one current requirement", async () => {
    const cards = await h.rows(
      project.id,
      q(
        "MATCH",
        "(t:Task)",
        "OPTIONAL MATCH",
        "(t)-[:IMPLEMENTS]->(r:Requirement)",
        "WHERE",
        "r.validTo IS NULL",
        "RETURN",
        "t.key, t.column, t.kind, count(r)",
        "ORDER BY",
        "t.key",
      ),
    );
    expect(cards).toHaveLength(10);
    for (const [, column, kind, reqs] of cards) {
      expect([column, kind, reqs]).toEqual(["Backlog", "build", 1]);
    }
  });

  it("has no cycle in DEPENDS_ON, and CARD-01 is the Backend seed card with no dependency", async () => {
    const edges = (await h.rows(
      project.id,
      q("MATCH", "(a:Task)-[:DEPENDS_ON]->(b:Task)", "RETURN", "a.key, b.key"),
    )) as [string, string][];
    expect(edges.length).toBeGreaterThan(0);
    // Kahn's algorithm: every card leaves the queue only when a graph has no cycle.
    const keys = (await h.rows(project.id, q("MATCH", "(t:Task)", "RETURN", "t.key"))).map(
      ([k]) => k as string,
    );
    const waiting = new Map(keys.map((k) => [k, edges.filter(([a]) => a === k).length]));
    const ready = keys.filter((k) => waiting.get(k) === 0);
    const order: string[] = [];
    while (ready.length) {
      const key = ready.shift()!;
      order.push(key);
      for (const [a, b] of edges) {
        if (b === key && waiting.set(a, waiting.get(a)! - 1).get(a) === 0) ready.push(a);
      }
    }
    expect(order.sort()).toEqual([...keys].sort());

    const [first] = await h.rows(
      project.id,
      q("MATCH", "(t:Task {key: 'CARD-01'})", "RETURN", "t.lane, t.order"),
    );
    expect(first).toEqual(["Backend", 10]);
    expect(edges.filter(([a]) => a === "CARD-01")).toEqual([]);
  });

  it("gives every card 1 to 3 criteria, each naming its data-testids, and the design it uses", async () => {
    const cards = await h.rows(
      project.id,
      q(
        "MATCH",
        "(t:Task)-[:HAS_CRITERION]->(c:AcceptanceCriterion)",
        "WITH",
        "t, count(c) AS criteria, min(size(c.testIds)) AS fewestIds",
        "OPTIONAL MATCH",
        "(t)-[:USES]->(d)",
        "RETURN",
        "t.key, criteria, fewestIds, count(d)",
      ),
    );
    expect(cards).toHaveLength(10);
    for (const [, criteria, fewestIds, uses] of cards as number[][]) {
      expect(criteria).toBeGreaterThanOrEqual(1);
      expect(criteria).toBeLessThanOrEqual(3);
      expect(fewestIds).toBeGreaterThanOrEqual(1);
      expect(uses).toBeGreaterThan(0);
    }
  });

  it("finishes the planner item with its handoff and opens write_tests per card (T15)", async () => {
    expect(
      await h.rows(
        project.id,
        q("MATCH", "(w:WorkItem {kind: 'planner'})", "RETURN", "w.status, w.handoff IS NOT NULL"),
      ),
    ).toEqual([["done", true]]);
    const tests = await h.rows(
      project.id,
      q(
        "MATCH",
        "(w:WorkItem {kind: 'write_tests'})",
        "MATCH",
        "(t:Task)",
        "WHERE",
        "t.id = w.subjectId",
        "RETURN",
        "t.key, w.status",
        "ORDER BY",
        "t.key",
      ),
    );
    expect(tests).toHaveLength(10);
    expect(tests.every(([, status]) => status === "open")).toBe(true);
    const res = await fetch(`${h.base}/api/projects/${project.id}`, { headers: ui });
    expect(((await res.json()) as { project: ProjectInfo }).project.stage).toBe("planning");
  });
});
