// Task 3.9, replan (stage-machine.md C2 and C3): set A runs to the Planner's cards on recorded
// replies; a change request in planning ends the slot-length fact, flags the cards built on it into
// Rework and opens replan; the Planner updates those cards in place, and C3 opens write_tests for each.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProjectInfo } from "@agencymem/contracts";
import { architect } from "../../apps/runner/src/agents/architect/agent";
import { discovery } from "../../apps/runner/src/agents/discovery/agent";
import { intake } from "../../apps/runner/src/agents/intake/agent";
import { planner } from "../../apps/runner/src/agents/planner/agent";
import { proposal } from "../../apps/runner/src/agents/proposal/agent";
import { changeRequest } from "../../apps/runner/src/agents/proposal/change-request";
import { writeTestsAgent } from "../../apps/runner/src/agents/test/write-tests";
import { ensureRepo } from "../../apps/runner/src/repo";
import { OWN_A, startHarness, ui, type Harness } from "./harness";

// Built at run time, so this file holds no Cypher string literal (AGENTS.md rule 4).
const q = (...parts: string[]) => parts.join(" ");
// As in test-writer.test.ts: the runner's own @playwright/test, linked at its real path.
const PLAYWRIGHT = realpathSync(
  fileURLToPath(new URL("../../apps/runner/node_modules/@playwright/test", import.meta.url)),
);
const workspaces = mkdtempSync(join(tmpdir(), "am-ws-"));
let link = "";

let h: Harness;
let project: ProjectInfo;
/** The flagged cards in Rework before the replan: key and version. */
let flagged: [string, number][];

const rework = () =>
  h.rows(
    project.id,
    q(
      "MATCH",
      "(t:Task {column: 'Rework'})-[:FLAGGED_BY]->(:ChangeRequest)",
      "RETURN",
      "t.key, t.version",
      "ORDER BY",
      "t.key",
    ),
  ) as Promise<[string, number][]>;

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
  // The specs first, as in a real project: every card Ready, its T15 write_tests item done.
  const repo = await ensureRepo(project.id, { workspacesDir: workspaces, install: false });
  mkdirSync(join(repo, "node_modules", "@playwright"), { recursive: true });
  link = join(repo, "node_modules", "@playwright", "test");
  symlinkSync(PLAYWRIGHT, link, "junction");
  const tester = writeTestsAgent({
    workspacesDir: workspaces,
    gatewayUrl: h.base,
    hookToken: "hook-t",
    install: false,
  });
  await h.run(tester, "test-A.json", project.id, 10);

  const res = await fetch(`${h.base}/api/projects/${project.id}/change-requests`, {
    method: "POST",
    headers: { ...ui, "Content-Type": "application/json", "X-AM-Actor": `persona:${project.id}` },
    body: JSON.stringify({ text: "Appointment slots are 30 minutes now." }),
  });
  expect(res.status).toBe(201);
  await h.run(changeRequest, "change-request-A.json", project.id, 1);
  flagged = await rework();
}, 300_000); // the whole chain from upload to the change request
afterAll(async () => {
  if (link) unlinkSync(link); // the link only, never the runner's install
  rmSync(workspaces, { recursive: true, force: true });
  await h.stop();
});

describe("replan (C2, C3): the Planner updates the cards a change request sent to Rework", () => {
  it("sends the cards built on the ended fact to Rework and opens one replan item (C2)", async () => {
    expect(flagged.length).toBeGreaterThan(0);
    expect(
      await h.rows(project.id, q("MATCH", "(w:WorkItem {kind: 'replan'})", "RETURN", "w.status")),
    ).toEqual([["open"]]);
  });

  it("updates each flagged card in Rework, and opens write_tests for each (C3)", async () => {
    await h.run(planner, "replan-A.json", project.id, 1);
    const after = await rework();
    expect(after.map(([key]) => key)).toEqual(flagged.map(([key]) => key));
    after.forEach(([, version], i) => expect(version).toBe(flagged[i]![1] + 1));
    const tests = await h.rows(
      project.id,
      q(
        "MATCH",
        "(w:WorkItem {kind: 'write_tests', status: 'open'})",
        "MATCH",
        "(t:Task)",
        "WHERE",
        "t.id = w.subjectId",
        "RETURN",
        "t.key",
        "ORDER BY",
        "t.key",
      ),
    );
    // The T15 items are done; C3 opened exactly one new item per flagged card, none for the others.
    expect(tests.map(([key]) => key)).toEqual(flagged.map(([key]) => key));
    // The slot length in the revised criterion text.
    expect(
      await h.rows(
        project.id,
        q("MATCH", "(k:AcceptanceCriterion {key: 'AC-03-1'})", "RETURN", "k.text"),
      ),
    ).toEqual([[expect.stringMatching(/30-minute/)]]);
  });
});
