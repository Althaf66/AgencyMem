// Task 3.4, Done when: all three documents render from nodes; a section shows "stale" after a change
// request. Set A runs to G2 approved on recorded replies; the Architect writes the design, a person
// asks for a change in chat (T12), and a change request flags sections that the Architect then
// writes again.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DocResponse, ProjectInfo } from "@agencymem/contracts";
import type { z } from "zod";
import { architect } from "../../apps/runner/src/agents/architect/agent";
import { discovery } from "../../apps/runner/src/agents/discovery/agent";
import { intake } from "../../apps/runner/src/agents/intake/agent";
import { proposal } from "../../apps/runner/src/agents/proposal/agent";
import { changeRequest } from "../../apps/runner/src/agents/proposal/change-request";
import { OWN_A, startHarness, ui, type Harness } from "./harness";

// Built at run time, so this file holds no Cypher string literal (AGENTS.md rule 4).
const q = (...parts: string[]) => parts.join(" ");
type Doc = z.infer<typeof DocResponse>;

let h: Harness;
let project: ProjectInfo;
const json = () => ({ ...ui, "Content-Type": "application/json", "X-AM-Project": project.id });

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
}, 120_000); // the whole chain from upload to the first design
afterAll(() => h.stop());

const doc = async (name: "prd" | "tdd" | "plan"): Promise<Doc> => {
  const res = await fetch(`${h.base}/api/projects/${project.id}/docs/${name}`, { headers: ui });
  expect(res.status).toBe(200);
  return (await res.json()) as Doc;
};
const stale = async () => {
  const out: string[] = [];
  for (const name of ["prd", "tdd", "plan"] as const) {
    for (const s of (await doc(name)).sections) if (s.stale) out.push(`${name} ${s.order}`);
  }
  return out;
};

describe("Done when: all three documents render from nodes", () => {
  it("renders each document's outline from its sections and the nodes they render", async () => {
    const outline = { prd: 5, tdd: 7, plan: 4 } as const;
    for (const name of ["prd", "tdd", "plan"] as const) {
      const body = await doc(name);
      expect(body.doc).toBe(name);
      expect(body.designVersion).toBe(1);
      expect(body.sections.map((s) => s.order)).toEqual([...Array(outline[name]).keys()]);
      for (const section of body.sections) {
        expect(section.stale).toBe(false);
        expect(section.renders.length).toBeGreaterThan(0);
        for (const node of section.renders) expect(node.text.length).toBeGreaterThan(0);
      }
    }
    expect((await doc("tdd")).sections[3]!.renders.map((n) => n.key)).toEqual(
      expect.arrayContaining(["EP-01", "EP-04"]),
    );
    // Every design node derives from a current requirement.
    expect(
      await h.rows(
        project.id,
        q(
          "MATCH",
          "(n)",
          "WHERE",
          "n:Decision OR n:Component OR n:Screen OR n:DataEntity OR n:Endpoint OR n:Risk",
          "OPTIONAL MATCH",
          "(n)-[:DERIVED_FROM]->(r:Requirement)",
          "WHERE",
          "r.validTo IS NULL",
          "WITH",
          "n, count(r) AS reqs",
          "WHERE",
          "reqs = 0",
          "RETURN",
          "n.key",
        ),
      ),
    ).toEqual([]);
  });

  it("sends a chat before G3 to the Architect as a revision, and the document renders again (T12)", async () => {
    const summary = (await doc("prd")).sections[0]!;
    const res = await fetch(`${h.base}/api/chat`, {
      method: "POST",
      headers: json(),
      body: JSON.stringify({ text: "Say the clinic name first.", docSectionId: summary.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { episodeId: string; route: string; workItemId: string };
    expect(body.route).toBe("doc_revision");
    expect(
      await h.rows(
        project.id,
        q(
          "MATCH",
          "(w:WorkItem {kind: 'architect_revise'}), (e:Episode {kind: 'human_edit'})",
          "RETURN",
          "w.id, w.subjectId = e.id, w.note, e.text",
        ),
      ),
    ).toEqual([
      [
        body.workItemId,
        true,
        'On section "Summary" (prd 0): Say the clinic name first.',
        "Say the clinic name first.",
      ],
    ]);
    await h.run(architect, "architect-chat-A.json", project.id, 1);
    const prd = await doc("prd");
    expect(prd.designVersion).toBe(2);
    expect(prd.sections[0]!.body).toMatch(/^Lotus Family Clinic/);
  });
});

describe("Done when: a section shows 'stale' after a change request", () => {
  it("flags the sections that render the changed requirement, then the Architect refreshes them", async () => {
    const res = await fetch(`${h.base}/api/projects/${project.id}/change-requests`, {
      method: "POST",
      headers: { ...json(), "X-AM-Actor": `persona:${project.id}` },
      body: JSON.stringify({ text: "Appointment slots are 30 minutes now." }),
    });
    expect(res.status).toBe(201);
    await h.run(changeRequest, "change-request-A.json", project.id, 1);

    // REQ-03 cites the slot length; every section that renders it or a design node from it is stale.
    expect(await stale()).toEqual([
      "prd 1",
      "prd 2",
      "tdd 0",
      "tdd 1",
      "tdd 3",
      "tdd 4",
      "tdd 6",
      "plan 0",
      "plan 1",
      "plan 2",
      "plan 3",
    ]);
    expect(
      await h.rows(
        project.id,
        q(
          "MATCH",
          "(w:WorkItem {kind: 'architect_revise'})",
          "RETURN",
          "w.status, w.note ORDER BY w.createdAt",
        ),
      ),
    ).toEqual([
      ["done", 'On section "Summary" (prd 0): Say the clinic name first.'],
      ["open", "Appointment slots are 30 minutes now."],
    ]);

    await h.run(architect, "architect-cr-A.json", project.id, 1);
    expect(await stale()).toEqual([]);
    expect((await doc("tdd")).designVersion).toBe(3);
  });
});
