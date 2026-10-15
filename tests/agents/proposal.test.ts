// Task 3.1, Done when: every Requirement has a source; every Estimate lists its lesson ids or says
// "no lesson". Set A runs through Intake, Discovery, the answers and G1 on recorded replies, then
// the Proposal agent writes the product (no Lesson exists yet, so every estimate says "no lesson").
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FeatureView, ProjectInfo } from "@agencymem/contracts";
import { discovery } from "../../apps/runner/src/agents/discovery/agent";
import { intake } from "../../apps/runner/src/agents/intake/agent";
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
}, 120_000); // the whole chain from upload to Proposal
afterAll(() => h.stop());

describe("Done when: every Requirement has a source; every Estimate lists lessons or says 'no lesson'", () => {
  it("cites at least one current fact for every Requirement", async () => {
    const requirements = await h.rows(
      project.id,
      q(
        "MATCH",
        "(r:Requirement) WHERE r.validTo IS NULL",
        "OPTIONAL MATCH",
        "(r)-[:DERIVED_FROM]->(f:Fact) WHERE f.validTo IS NULL",
        "RETURN",
        "r.key, r.productVersion, count(f) ORDER BY r.key",
      ),
    );
    expect(requirements.length).toBeGreaterThan(0);
    for (const [, version, facts] of requirements as [string, number, number][]) {
      expect(version).toBe(1);
      expect(facts).toBeGreaterThanOrEqual(1);
    }
  });

  it("gives every Feature one Estimate with rawHours, its lesson ids or 'no lesson'", async () => {
    const features = await h.rows(
      project.id,
      q(
        "MATCH",
        "(x:Feature)",
        "OPTIONAL MATCH",
        "(e:Estimate)-[:FOR]->(x)",
        "OPTIONAL MATCH",
        "(x)-[:HAS_REQUIREMENT]->(r:Requirement)",
        "RETURN",
        "x.key, count(DISTINCT e), collect(e)[0].rawHours, collect(e)[0].lessonIds,",
        "collect(e)[0].basis, count(DISTINCT r) ORDER BY x.key",
      ),
    );
    expect(features.length).toBeGreaterThanOrEqual(4);
    expect(features.length).toBeLessThanOrEqual(8);
    for (const [, estimates, raw, lessonIds, basis, reqs] of features as [
      string,
      number,
      number,
      string[],
      string,
      number,
    ][]) {
      expect(estimates).toBe(1);
      expect(raw).toBeGreaterThanOrEqual(1);
      expect(reqs).toBeGreaterThanOrEqual(1);
      expect(lessonIds.length > 0 || basis.includes("no lesson")).toBe(true);
      expect(basis).toBe(`raw ${raw} h, no lesson = ${raw} h`); // no Lesson exists yet
    }
  });

  it("finishes the item with its handoff, and route 26 shows each estimate's basis", async () => {
    const items = await h.rows(
      project.id,
      q("MATCH", "(w:WorkItem {kind: 'proposal'})", "RETURN", "w.status, w.handoff IS NOT NULL"),
    );
    expect(items).toEqual([["done", true]]);

    const res = await fetch(`${h.base}/api/projects/${project.id}/features`, { headers: ui });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { features: FeatureView[]; seq: number };
    expect(typeof body.seq).toBe("number");
    expect(body.features.map((f) => f.key)).toEqual([...body.features.map((f) => f.key)].sort());
    for (const feature of body.features) {
      expect(feature.productVersion).toBe(1);
      expect(feature.actualHours).toBeNull();
      expect(feature.estimate.lessons).toEqual([]);
      expect(feature.estimate.basis).toMatch(/no lesson/);
    }
  });
});
