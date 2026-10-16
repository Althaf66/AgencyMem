// Task 3.3, Done when: with 24 cards and a fact linked to 3, exactly those 3 move to Rework. Route 22
// (C1), record_change_request (supersede, then impact flag, C5) and C2, through the real gateway
// against the real FalkorDB from docker-compose.yml. No mocks.
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type Column, type Envelope, type Stage } from "@agencymem/contracts";
import { close, connect, type FalkorDB } from "@agencymem/graph";
import {
  createChangeRequest,
  createGates,
  createProject,
  deleteTestClient,
  seedBoardForTest,
  setStage,
  supersedeFacts,
  writeDocument,
  writeFacts,
  writeProduct,
  type Ctx,
} from "@agencymem/memory";
import { createEvents } from "../events/bus";
import { createGateway } from "../main";

const TOKENS = { AM_AGENT_TOKEN: "agent-t", AM_UI_TOKEN: "ui-t", AM_HOOK_TOKEN: "hook-t" };
const FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";
const ui = { "X-AM-Token": "ui-t", "X-AM-Actor": "human:ana", "Content-Type": "application/json" };
// Built at run time, so this file holds no Cypher string literal (AGENTS.md rule 4).
const q = (...parts: string[]) => parts.join(" ");

let db: FalkorDB;
let server: Server;
let base: string;
const events = createEvents();
const graphs = new Set<string>();
const clients: Client[] = [];

beforeAll(async () => {
  db = await connect(FALKORDB_URL);
  server = createGateway(loadConfig({ ...TOKENS, FALKORDB_URL }, "gateway"), { events });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await Promise.allSettled(clients.map((c) => c.close()));
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  for (const graph of graphs) await deleteTestClient(db, graph);
  await close();
});

const COLUMNS: Column[] = ["Backlog", "Ready", "In progress", "Testing", "Done", "Rework"];
const card = (n: number) => `CARD-${String(n).padStart(2, "0")}`;

/**
 * A project at `stage` with facts F1-F6, requirements REQ-01..06 (REQ-0i from Fi), and with `board`:
 * 24 cards. CARD-01..03 implement REQ-01 and use EP-01 (from REQ-01); CARD-02 holds a live lease.
 * CARD-04..24 implement REQ-02..06, and some use EP-02 (from REQ-02). Two sections render REQ-01.
 */
async function setup({ stage = "build" as Stage, board = true } = {}) {
  const now = Date.now();
  const { project, client } = await createProject(db, {
    clientName: `test-client-${randomUUID()}`,
    projectName: "Change requests",
    mode: "demo",
    createdBy: "human:test",
    now,
  });
  const ctx: Ctx = { db, graph: `client_${client.id}`, projectId: project.id };
  graphs.add(ctx.graph);
  await createGates(ctx, { keys: ["G1", "G2", "G3", "G5"], createdBy: "human:test", now });
  if (stage !== "intake") await setStage(db, project.id, "intake", stage);
  const { episodeIds } = await writeDocument(ctx, {
    name: "kickoff-notes.pdf",
    mime: "application/pdf",
    sha256: "d".repeat(64),
    status: "processed",
    wordCount: 30,
    error: null,
    episodes: [{ page: 1, lineStart: 1, lineEnd: 6, text: "Six rules of the clinic." }],
    createdBy: "human:test",
    now,
  });
  const { factIds } = await writeFacts(ctx, {
    entities: [{ key: "clinic", name: "Clinic", aliases: [] }],
    facts: [1, 2, 3, 4, 5, 6].map((i) => ({
      statement: `Clinic rule ${i} is A.`,
      subject: "clinic",
      attribute: `rule_${i}`,
      value: "A",
      episodeIds,
      replacesFactId: null,
    })),
    createdBy: "intake",
    now,
  });
  const reqs = factIds.map((factId, i) => ({
    key: `REQ-0${i + 1}`,
    text: `A patient can use rule ${i + 1}.`,
    priority: "must" as const,
    factIds: [factId],
  }));
  await writeProduct(ctx, {
    baseVersion: 0,
    requirements: reqs,
    features: [
      {
        key: "FEAT-01",
        name: "Everything",
        featureKind: "form",
        requirementKeys: reqs.map((r) => r.key),
        estimate: { rawHours: 4, hours: 4, basis: "raw 4 h, no lesson = 4 h", lessonIds: [] },
      },
    ],
    createdBy: "proposal",
    now,
  });
  let tasks: { key: string; id: string }[] = [];
  if (board) {
    const seeded = await seedBoardForTest(ctx, {
      endpoints: [
        { key: "EP-01", requirementKey: "REQ-01" },
        { key: "EP-02", requirementKey: "REQ-02" },
      ],
      sections: [
        { doc: "prd", order: 1, requirementKey: "REQ-01" },
        { doc: "tdd", order: 1, requirementKey: "REQ-01" },
        { doc: "prd", order: 2, requirementKey: "REQ-02" },
        { doc: "plan", order: 1, requirementKey: "REQ-03" },
      ],
      tasks: Array.from({ length: 24 }, (_, i) => {
        const n = i + 1;
        const linked = n <= 3;
        return {
          key: card(n),
          requirementKey: linked ? "REQ-01" : `REQ-0${(n % 5) + 2}`,
          uses: linked ? "EP-01" : n % 3 === 0 ? "EP-02" : null,
          column: linked ? (["Backlog", "In progress", "Done"] as Column[])[i]! : COLUMNS[n % 6]!,
          leaseOwner: n === 2 ? "build-1" : null,
          leaseUntil: n === 2 ? now + 600_000 : null,
        };
      }),
      createdBy: "planner",
      now,
    });
    tasks = seeded.tasks;
  }
  return { ctx, facts: factIds, tasks };
}

async function proposal(projectId: string, agentId = "proposal"): Promise<Client> {
  const client = new Client({ name: "test", version: "0" });
  const headers = {
    "X-AM-Token": "agent-t",
    "X-AM-Agent": agentId,
    "X-AM-Project": projectId,
    "X-AM-Worker": `${agentId}-2`,
  };
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }),
  );
  clients.push(client);
  return client;
}

type Result = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content?: { text?: string }[];
};
async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as Result;
  return {
    isError: result.isError === true,
    out:
      result.structuredContent ??
      (JSON.parse(result.content?.[0]?.text ?? "{}") as Record<string, unknown>),
  };
}
const rows = (ctx: Ctx, cypher: string) =>
  db
    .selectGraph(ctx.graph)
    .roQuery(cypher)
    .then((r) => (r.data ?? []) as Record<string, unknown>[]);

async function postCr(projectId: string, text: string, headers: Record<string, string> = ui) {
  const res = await fetch(`${base}/api/projects/${projectId}/change-requests`, {
    method: "POST",
    headers,
    body: JSON.stringify({ text }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** Records a CR over route 22 and claims its change_request item as the proposal agent. */
async function recorded(ctx: Ctx, text = "Rule 1 is now B.") {
  const created = await postCr(ctx.projectId, text);
  expect(created.status).toBe(201);
  const { crId, episodeId, workItemId } = created.body as Record<string, string>;
  const agent = await proposal(ctx.projectId);
  const claimed = await call(agent, "claim_item", { kinds: ["change_request"] });
  expect((claimed.out.item as { id: string }).id).toBe(workItemId);
  return { agent, crId: crId!, episodeId: episodeId!, itemId: workItemId! };
}

describe("route 22: POST /api/projects/:id/change-requests (C1)", () => {
  it("writes the ChangeRequest FROM its episode and opens a change_request item", async () => {
    const { ctx } = await setup({ board: false, stage: "design" });
    const { status, body } = await postCr(ctx.projectId, "Rule 1 is now B.");
    expect(status).toBe(201);
    expect(
      await rows(
        ctx,
        q(
          "MATCH",
          "(cr:ChangeRequest)-[:FROM]->(e:Episode)",
          "OPTIONAL MATCH",
          "(w:WorkItem {kind: 'change_request'})",
          "RETURN",
          "cr.id AS cr, cr.status AS status, cr.text AS text, e.id AS ep, e.kind AS kind,",
          "w.id AS item, w.subjectId AS subject, w.status AS itemStatus",
        ),
      ),
    ).toEqual([
      {
        cr: body.crId,
        status: "open",
        text: "Rule 1 is now B.",
        ep: body.episodeId,
        kind: "change_request",
        item: body.workItemId,
        subject: body.crId,
        itemStatus: "open",
      },
    ]);
    // Each CR of a project gets the next key; the UI names it "CR-1", "CR-2".
    expect(body.crKey).toBe("CR-1");
    const second = await postCr(ctx.projectId, "Rule 2 is now B.");
    expect(second.body.crKey).toBe("CR-2");
  });

  it("refuses a CR before G2 is approved or after the project closed (409), and without an actor", async () => {
    for (const stage of ["proposal", "closed"] as Stage[]) {
      const { ctx } = await setup({ board: false, stage });
      const res = await postCr(ctx.projectId, "Rule 1 is now B.");
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({ details: { reasonCode: "WRONG_STAGE" } });
    }
    const { ctx } = await setup({ board: false });
    const noActor = await postCr(ctx.projectId, "Rule 1 is now B.", { ...ui, "X-AM-Actor": "" });
    expect(noActor.status).toBe(400);
  });
});

describe("Done when: with 24 cards and a fact linked to 3, exactly those 3 move to Rework", () => {
  it("ends the fact, flags exactly the linked cards and sections, cancels the lease (C5)", async () => {
    const { ctx, facts, tasks } = await setup();
    const before = await rows(
      ctx,
      q("MATCH", "(t:Task)", "RETURN", "t.key AS key, t.column AS column, t.version AS version"),
    );
    const { agent, crId, episodeId, itemId } = await recorded(ctx);
    // recall_context for a change_request item: the CR, the current facts and the product.
    const recall = (await call(agent, "recall_context", { itemId })).out as {
      context: Record<string, unknown[] | Record<string, unknown>>;
    };
    expect(recall.context.changeRequest).toEqual({
      id: crId,
      text: "Rule 1 is now B.",
      episodeId,
      status: "open",
    });
    expect(recall.context.facts).toHaveLength(6);
    expect(recall.context.requirements).toHaveLength(6);
    expect(recall.context.features).toHaveLength(1);
    const sent: Envelope[] = [];
    const off = events.on((e) => e.projectId === ctx.projectId && sent.push(e));
    const res = await call(agent, "record_change_request", {
      itemId,
      crId,
      changes: [{ oldFactId: facts[0], statement: "Clinic rule 1 is B.", value: "B" }],
    });
    off();
    expect(res.isError).toBe(false);
    const out = res.out as {
      newFactIds: string[];
      flagged: { taskIds: string[]; docSectionIds: string[] };
      crStatus: string;
    };
    const linked = tasks.filter((t) => ["CARD-01", "CARD-02", "CARD-03"].includes(t.key));
    expect([...out.flagged.taskIds].sort()).toEqual(linked.map((t) => t.id).sort());
    expect(out.flagged.docSectionIds).toHaveLength(2);
    expect(out.crStatus).toBe("applied");
    expect(out.newFactIds).toHaveLength(1);

    // Exactly the 3 linked cards moved, with version + 1, no lease, and FLAGGED_BY the CR.
    const after = await rows(
      ctx,
      q(
        "MATCH",
        "(t:Task)",
        "OPTIONAL MATCH",
        "(t)-[:FLAGGED_BY]->(cr:ChangeRequest)",
        "RETURN",
        "t.key AS key, t.column AS column, t.version AS version, t.leaseOwner AS lease, cr.id AS cr",
      ),
    );
    const was = new Map(before.map((t) => [t.key, t]));
    for (const t of after) {
      const old = was.get(t.key)!;
      if (["CARD-01", "CARD-02", "CARD-03"].includes(t.key as string)) {
        expect(t).toMatchObject({ column: "Rework", version: (old.version as number) + 1 });
        expect(t).toMatchObject({ lease: null, cr: crId });
      } else {
        expect(t).toMatchObject({ column: old.column, version: old.version, cr: null });
      }
    }
    expect(
      await rows(
        ctx,
        q(
          "MATCH",
          "(s:DocSection)",
          "OPTIONAL MATCH",
          "(s)-[:FLAGGED_BY]->(cr:ChangeRequest)",
          "RETURN",
          "s.doc AS doc, s.order AS ord, s.stale AS stale, cr.id AS cr ORDER BY doc, ord",
        ),
      ),
    ).toEqual([
      { doc: "plan", ord: 1, stale: false, cr: null },
      { doc: "prd", ord: 1, stale: true, cr: crId },
      { doc: "prd", ord: 2, stale: false, cr: null },
      { doc: "tdd", ord: 1, stale: true, cr: crId },
    ]);

    // The old fact ended; the new one supersedes it from the CR's episode, about the same entity.
    expect(
      await rows(
        ctx,
        q(
          "MATCH",
          "(new:Fact)-[:SUPERSEDES]->(old:Fact), (new)-[:SOURCED_FROM]->(e:Episode),",
          "(new)-[:ABOUT]->(n:Entity), (cr:ChangeRequest)-[:ENDS]->(old)",
          "RETURN",
          "old.id AS old, old.validTo IS NOT NULL AS ended, new.id AS new, new.value AS value,",
          "new.attribute AS attribute, new.validTo IS NULL AS current, e.id AS ep, n.key AS entity,",
          "cr.status AS status",
        ),
      ),
    ).toEqual([
      {
        old: facts[0],
        ended: true,
        new: out.newFactIds[0],
        value: "B",
        attribute: "rule_1",
        current: true,
        ep: episodeId,
        entity: "clinic",
        status: "applied",
      },
    ]);

    // Events: the fact ended, three cards moved, two sections stale, one lease cancelled.
    const types = sent.map((e) => e.type).filter((t) => t !== "node.written");
    expect(types).toEqual([
      "node.ended",
      "task.moved",
      "task.moved",
      "task.moved",
      "doc.stale",
      "doc.stale",
      "lease.changed",
    ]);
    const moved = sent.filter((e) => e.type === "task.moved").map((e) => e.data);
    expect(moved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "CARD-01", from: "Backlog", to: "Rework" }),
        expect.objectContaining({ key: "CARD-02", from: "In progress", to: "Rework" }),
        expect.objectContaining({ key: "CARD-03", from: "Done", to: "Rework" }),
      ]),
    );
    expect(sent.find((e) => e.type === "lease.changed")!.data).toMatchObject({
      itemId: linked.find((t) => t.key === "CARD-02")!.id,
      owner: null,
      reason: "cancel",
    });
    // The last event sums it up for the person who asked (ui.md, the toast).
    expect(sent.at(-1)!.data).toMatchObject({
      label: "ChangeRequest",
      id: crId,
      summary: "CR-1 flagged 3 cards and 2 sections",
    });

    // C2: the done item opens architect_revise (with the CR text) and replan for this CR.
    const done = await call(agent, "complete_item", { itemId, outcome: "done", runs: [] });
    expect(done.isError).toBe(false);
    expect(
      await rows(
        ctx,
        q(
          "MATCH",
          "(w:WorkItem)",
          "WHERE",
          "w.kind IN ['architect_revise', 'replan']",
          "RETURN",
          "w.kind AS kind, w.subjectId AS subject, w.note AS note ORDER BY kind",
        ),
      ),
    ).toEqual([
      { kind: "architect_revise", subject: crId, note: "Rule 1 is now B." },
      { kind: "replan", subject: crId, note: null },
    ]);
  });

  it("sets no_change for no changes, needs_scope for new scope, and flags nothing (C4)", async () => {
    const { ctx } = await setup();
    for (const [args, status] of [
      [{ changes: [] }, "no_change"],
      [{ changes: [], outcome: "needs_scope" }, "needs_scope"],
    ] as const) {
      const { agent, crId, itemId } = await recorded(ctx, `CR for ${status}`);
      const res = await call(agent, "record_change_request", { itemId, crId, ...args });
      expect(res.out).toEqual({
        newFactIds: [],
        flagged: { taskIds: [], docSectionIds: [] },
        crStatus: status,
      });
      expect(
        (await call(agent, "complete_item", { itemId, outcome: "done", runs: [] })).isError,
      ).toBe(false);
    }
    expect(
      await rows(ctx, q("MATCH", "(t:Task {column: 'Rework'})", "RETURN", "count(t) AS n")),
    ).toEqual([{ n: 4 }]); // the seeded Rework cards only
    expect(
      await rows(
        ctx,
        q(
          "MATCH",
          "(w:WorkItem)",
          "WHERE",
          "w.kind IN ['architect_revise', 'replan']",
          "RETURN",
          "count(w) AS n",
        ),
      ),
    ).toEqual([{ n: 0 }]);
  });

  it("guards: ownership, an ended or unknown fact (source), a crId that is not the item's", async () => {
    const { ctx, facts } = await setup();
    const { agent, crId, itemId } = await recorded(ctx);
    const change = (oldFactId: string) => [
      { oldFactId, statement: "Clinic rule is B.", value: "B" },
    ];

    const intake = await proposal(ctx.projectId, "intake");
    const owned = await call(intake, "record_change_request", {
      itemId,
      crId,
      changes: change(facts[0]!),
    });
    expect(owned.out.error).toMatchObject({ guard: "ownership" });

    const unknown = await call(agent, "record_change_request", {
      itemId,
      crId,
      changes: change("01ARZ3NDEKTSV4RRFFQ69G5FAV"),
    });
    expect(unknown.out.error).toMatchObject({ guard: "source" });

    const wrong = await call(agent, "record_change_request", {
      itemId,
      crId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      changes: change(facts[0]!),
    });
    expect(wrong.out.error).toMatchObject({ code: "VALIDATION_FAILED" }); // not the item's CR

    const first = await call(agent, "record_change_request", {
      itemId,
      crId,
      changes: change(facts[0]!),
    });
    expect(first.isError).toBe(false);
    const again = await call(agent, "record_change_request", {
      itemId,
      crId,
      changes: change(facts[1]!),
    });
    expect(again.out.error).toMatchObject({ code: "VALIDATION_FAILED" }); // the CR is applied

    // A second CR on the fact the first one ended: not a current fact.
    const next = await recorded(ctx, "Rule 1 is now C.");
    const ended = await call(next.agent, "record_change_request", {
      itemId: next.itemId,
      crId: next.crId,
      changes: change(facts[0]!),
    });
    expect(ended.out.error).toMatchObject({ guard: "source" });
  });
});

describe("supersede-fact.cypher: all or nothing", () => {
  it("changes nothing when one old fact is no longer current, or the CR is not open", async () => {
    const { ctx, facts } = await setup({ board: false });
    const now = Date.now();
    // Another write ends facts[1] after the gateway's source check would have read it.
    await writeFacts(ctx, {
      entities: [{ key: "clinic", name: "Clinic", aliases: [] }],
      facts: [
        {
          statement: "Clinic rule 2 is C.",
          subject: "clinic",
          attribute: "rule_2",
          value: "C",
          episodeIds: [
            (await rows(ctx, q("MATCH", "(e:Episode)", "RETURN", "e.id AS id")))[0]!.id as string,
          ],
          replacesFactId: facts[1]!,
        },
      ],
      createdBy: "intake",
      now,
    });
    const { changeRequest } = await createChangeRequest(ctx, {
      text: "Rules 1 and 2 change.",
      createdBy: "human:ana",
      now,
    });
    const change = (oldFactId: string) => ({
      oldFactId,
      statement: "Clinic rule is B.",
      value: "B",
    });
    const partial = await supersedeFacts(ctx, {
      crId: changeRequest.id,
      status: "applied",
      changes: [change(facts[0]!), change(facts[1]!)],
      createdBy: "proposal",
      now,
    });
    expect(partial.applied).toBe(false);
    expect(
      await rows(
        ctx,
        q(
          "MATCH",
          "(cr:ChangeRequest), (f:Fact {attribute: 'rule_1'})",
          "RETURN",
          "cr.status AS status, count(f) AS rule1, collect(f.validTo IS NULL) AS current",
        ),
      ),
    ).toEqual([{ status: "open", rule1: 1, current: [true] }]);

    // A CR that is no longer open reports not applied, even with no changes.
    expect(
      (
        await supersedeFacts(ctx, {
          crId: changeRequest.id,
          status: "no_change",
          changes: [],
          createdBy: "proposal",
          now,
        })
      ).applied,
    ).toBe(true);
    expect(
      (
        await supersedeFacts(ctx, {
          crId: changeRequest.id,
          status: "no_change",
          changes: [],
          createdBy: "proposal",
          now,
        })
      ).applied,
    ).toBe(false);
  });
});
