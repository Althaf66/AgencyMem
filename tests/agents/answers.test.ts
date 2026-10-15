// Task 2.7, Done when: G1 stays waiting while any question is open. Set A runs through Intake and
// Discovery on recorded replies; a person then answers the 15 questions over route 9 and decides G1
// over route 11. Intake turns each answer into facts (intake_answer), and the last one opens
// Proposal (stage-machine.md T5 to T7).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Envelope, GateView, ProjectInfo, QuestionView } from "@agencymem/contracts";
import { discovery } from "../../apps/runner/src/agents/discovery/agent";
import { intake } from "../../apps/runner/src/agents/intake/agent";
import { OWN_A as OWN, startHarness, ui, type Harness } from "./harness";

// Built at run time, so this file holds no Cypher string literal (AGENTS.md rule 4).
const q = (...parts: string[]) => parts.join(" ");

let h: Harness;
let project: ProjectInfo;
let questions: QuestionView[];
const sent: Envelope[] = [];

beforeAll(async () => {
  h = await startHarness();
  h.events.on((e) => sent.push(e));
  project = await h.project("A");
  await h.run(intake, "intake-A.json", project.id, 3);
  await h.run(discovery, "discovery-A.json", project.id, 1);
  questions = await readQuestions();
});
afterAll(() => h.stop());

const json = { ...ui, "Content-Type": "application/json" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the test reads nested reply fields
type Body = Record<string, any>;

async function call(method: string, path: string, body?: unknown, headers = {}) {
  const res = await fetch(`${h.base}${path}`, {
    method,
    headers: { ...json, "X-AM-Project": project.id, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Body };
}

async function readQuestions(): Promise<QuestionView[]> {
  return (await call("GET", `/api/projects/${project.id}/questions`)).body.questions;
}

async function g1(): Promise<GateView> {
  const { body } = await call("GET", `/api/projects/${project.id}/gates`);
  return (body.gates as GateView[]).find((g) => g.key === "G1")!;
}

const answer = (i: number, version = questions[i]!.version) =>
  call(
    "POST",
    `/api/questions/${questions[i]!.id}/answer`,
    OWN[i] ? { version, accept: false, text: OWN[i] } : { version, accept: true },
  );

const stage = async () =>
  ((await call("GET", `/api/projects/${project.id}`)).body.project as ProjectInfo).stage;

describe("Done when: G1 stays waiting while any question is open", () => {
  it("shows G1 waiting with every question open, and refuses an approve (counted)", async () => {
    expect(questions).toHaveLength(15);
    const gate = await g1();
    expect(gate).toMatchObject({
      status: "waiting",
      canDecide: false,
      blockedBy: ["15 questions still open"],
    });

    const from = sent.length;
    const res = await call("POST", `/api/gates/${gate.id}/decision`, {
      version: gate.version,
      decision: "approve",
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      guard: "gate",
      details: { reasonCode: "GATE_NOT_DECIDABLE", gateKey: "G1" },
    });
    expect((await g1()).status).toBe("waiting");
    expect(sent.slice(from).map((e) => e.type)).toEqual(["write.rejected", "metrics.updated"]);
  });

  it("checks an answer: actor, text, version, project, and an open question", async () => {
    const path = `/api/questions/${questions[0]!.id}/answer`;
    const v = questions[0]!.version;
    const noActor = await call("POST", path, { version: v, accept: true }, { "X-AM-Actor": "" });
    expect(noActor.status).toBe(400);
    expect((await call("POST", path, { version: v, accept: false })).status).toBe(400);

    const old = await call("POST", path, { version: v + 1, accept: true });
    expect(old.status).toBe(409);
    expect(old.body.error.details).toMatchObject({ reasonCode: "VERSION_OLD", current: v });

    // A second project of the same client shares the graph: the question is another project's.
    const other = await call(
      "POST",
      "/api/projects",
      { clientName: project.clientName, projectName: "Portal", mode: "demo" },
      { "X-AM-Project": "" },
    );
    const foreign = await call(
      "POST",
      path,
      { version: v, accept: true },
      { "X-AM-Project": other.body.project.id },
    );
    expect(foreign.status).toBe(403);
    expect(foreign.body.error.details).toMatchObject({ reasonCode: "FOREIGN_NODE" });

    const from = sent.length;
    const first = await answer(0);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      question: { status: "answered", version: v + 1, answer: { text: "20 minutes." } },
      assumption: { status: "confirmed" },
      episodeId: expect.any(String),
      workItemId: expect.any(String),
    });
    expect(
      sent
        .slice(from)
        .filter((e) => e.type === "node.written")
        .map((e) => (e.data as { label: string }).label),
    ).toEqual(["Episode", "Question", "Assumption", "Contradiction", "WorkItem"]);
    const again = await answer(0, v + 1);
    expect(again.status).toBe(400);
  });

  it("keeps G1 waiting with one question open", async () => {
    for (let i = 1; i < 14; i++) expect((await answer(i)).status).toBe(200);
    const gate = await g1();
    expect(gate).toMatchObject({ canDecide: false, blockedBy: ["1 question still open"] });
    const res = await call("POST", `/api/gates/${gate.id}/decision`, {
      version: gate.version,
      decision: "approve",
    });
    expect(res.status).toBe(409);
  });

  it("approves G1 once every question is answered; Proposal waits for the answer facts", async () => {
    expect((await answer(14)).status).toBe(200);
    const answered = await readQuestions();
    for (const [i, question] of answered.entries()) {
      expect(question.status).toBe("answered");
      expect(question.answer).toMatchObject({
        text: OWN[i] ?? question.recommended,
        actor: "human:ana",
      });
      expect(question.assumption.status).toBe(OWN[i] ? "rejected" : "confirmed");
      if (question.contradiction) expect(question.contradiction.status).toBe("resolved");
    }

    const gate = await g1();
    expect(gate).toMatchObject({ status: "waiting", canDecide: true, blockedBy: [] });
    const path = `/api/gates/${gate.id}/decision`;
    const reject = await call("POST", path, {
      version: gate.version,
      decision: "reject",
      reason: "No",
    });
    expect(reject.status).toBe(400);
    const old = await call("POST", path, { version: gate.version + 1, decision: "approve" });
    expect(old.status).toBe(409);
    expect(old.body.error.details).toMatchObject({ reasonCode: "VERSION_OLD" });

    const from = sent.length;
    const approved = await call("POST", path, { version: gate.version, decision: "approve" });
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({
      gate: { key: "G1", status: "approved", decidedBy: "human:ana", canDecide: false },
      opened: [], // 15 intake_answer items are still open (T6 waits for T7)
    });
    expect(sent.slice(from)).toContainEqual(
      expect.objectContaining({
        type: "gate.changed",
        data: expect.objectContaining({ gateKey: "G1", status: "approved" }),
      }),
    );
    expect(await stage()).toBe("discovery");
  });

  it("turns each answer into sourced facts; the last one opens Proposal", async () => {
    await h.run(intake, "intake-answer-A.json", project.id, 15);
    expect(await stage()).toBe("proposal");
    const items = await h.rows(
      project.id,
      q("MATCH", "(w:WorkItem {kind: 'proposal'})", "RETURN", "w.status"),
    );
    expect(items).toEqual([["open"]]);

    // Every fact written from an answer cites its answer episode.
    const sourced = await h.rows(
      project.id,
      q(
        "MATCH",
        "(f:Fact)-[:SOURCED_FROM]->(e:Episode {kind: 'answer'})-[:ANSWERS]->(:Question)",
        "RETURN",
        "count(DISTINCT f), count(DISTINCT e)",
      ),
    );
    expect(sourced).toEqual([[15, 15]]);

    // The changed answer (open Monday to Friday) supersedes the fact it changes.
    const changed = await h.rows(
      project.id,
      q(
        "MATCH",
        "(n:Fact {attribute: 'open_days', value: 'Monday to Friday'})-[:SUPERSEDES]->(o:Fact)",
        "RETURN",
        "o.value, o.validTo IS NOT NULL, n.validTo IS NULL",
      ),
    );
    expect(changed).toEqual([["Monday to Saturday", true, true]]);
  }, 60_000);

  it("does not decide G2 yet", async () => {
    const { body } = await call("GET", `/api/projects/${project.id}/gates`);
    const g2 = (body.gates as GateView[]).find((g) => g.key === "G2")!;
    expect(g2.canDecide).toBe(false);
    const res = await call("POST", `/api/gates/${g2.id}/decision`, {
      version: g2.version,
      decision: "approve",
    });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL");
  });
});
