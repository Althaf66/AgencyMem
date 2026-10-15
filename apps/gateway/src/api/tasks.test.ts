// Task 3.9, Done when: a human edit during a lease makes the agent's next write fail. Routes 12 to
// 15 and 31 of contracts.md section 8 and the human moves H1 to H7 (stage-machine.md section 6),
// through the real gateway against the real FalkorDB from docker-compose.yml. No mocks.
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  loadConfig,
  type CardView,
  type Envelope,
  type ItemView,
  type ProgressView,
} from "@agencymem/contracts";
import { REGISTRY_GRAPH, close, connect, readQuery, type FalkorDB } from "@agencymem/graph";
import {
  createChangeRequest,
  createGates,
  createProject,
  deleteTestClient,
  flagImpact,
  openItem,
  setStage,
  supersedeFacts,
  writeCards,
  writeDesign,
  writeDocument,
  writeFacts,
  writeProduct,
  writeTests,
  writeVersioned,
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

const card = (n: number, requirementKey: string, lane = "Backend") => ({
  key: `CARD-0${n}`,
  title: `Card ${n}`,
  description: `Builds part ${n}.`,
  lane,
  order: n * 10,
  requirementKey,
  designKeys: requirementKey === "REQ-01" ? ["EP-01"] : [],
  dependsOn: [],
  criteria: [1, 2].map((i) => ({
    key: `AC-0${n}-${i}`,
    text: `Given part ${n}.${i}, when it runs, then it works.`,
    testIds: ["book-submit"],
  })),
});

/**
 * A project in build with facts F1-F2, REQ-01..02, EP-01, and four Backlog cards (CARD-01..03 on
 * REQ-01, CARD-04 on REQ-02 in the Frontend lane), each with two criteria and no TestCase.
 */
async function setup() {
  const now = Date.now();
  const { project, client } = await createProject(db, {
    clientName: `test-client-${randomUUID()}`,
    projectName: "Board",
    mode: "demo",
    createdBy: "human:test",
    now,
  });
  const ctx: Ctx = { db, graph: `client_${client.id}`, projectId: project.id };
  graphs.add(ctx.graph);
  await createGates(ctx, { keys: ["G1", "G2", "G3", "G5"], createdBy: "human:test", now });
  await setStage(db, project.id, "intake", "build");
  const { episodeIds } = await writeDocument(ctx, {
    name: "kickoff-notes.pdf",
    mime: "application/pdf",
    sha256: "b".repeat(64),
    status: "processed",
    wordCount: 20,
    error: null,
    episodes: [{ page: 1, lineStart: 1, lineEnd: 2, text: "Two rules." }],
    createdBy: "human:test",
    now,
  });
  const { factIds } = await writeFacts(ctx, {
    entities: [{ key: "clinic", name: "Clinic", aliases: [] }],
    facts: [1, 2].map((i) => ({
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
  await writeProduct(ctx, {
    baseVersion: 0,
    requirements: factIds.map((factId, i) => ({
      key: `REQ-0${i + 1}`,
      text: `A patient can use rule ${i + 1}.`,
      priority: "must" as const,
      factIds: [factId],
    })),
    features: [
      {
        key: "FEAT-01",
        name: "Booking",
        featureKind: "form",
        requirementKeys: ["REQ-01", "REQ-02"],
        estimate: { rawHours: 4, hours: 4, basis: "raw 4 h, no lesson = 4 h", lessonIds: [] },
      },
    ],
    createdBy: "proposal",
    now,
  });
  await writeDesign(ctx, {
    baseVersion: 0,
    nodes: [
      {
        label: "Endpoint",
        key: "EP-01",
        name: "Book",
        body: "Books a slot.",
        method: "POST",
        path: "/api/bookings",
        requirementKeys: ["REQ-01"],
      },
    ],
    sections: [],
    createdBy: "architect",
    now,
  });
  const { taskIds } = (await writeCards(ctx, {
    cards: [
      card(1, "REQ-01"),
      card(2, "REQ-01"),
      card(3, "REQ-01"),
      card(4, "REQ-02", "Frontend"),
    ] as never,
    createdBy: "planner",
    now,
  }))!;
  return { ctx, ids: taskIds, facts: factIds };
}

/** Sets a card's fields straight in the graph (columns and leases the board starts from). */
async function put(ctx: Ctx, id: string, props: Record<string, string | number | null>) {
  const [row] = await readQuery<{ n: { properties: { version: number } } }>(
    db,
    ctx.graph,
    "read/node",
    { id },
  );
  await writeVersioned(ctx, { id, version: row!.n.properties.version, props });
}
/** Covers every criterion of a card with a TestCase. */
const cover = (ctx: Ctx, id: string, n: number) =>
  writeTests(ctx, {
    taskId: id,
    cases: [1, 2].map((i) => ({
      criterionKey: `AC-0${n}-${i}`,
      file: `tests/e2e/CARD-0${n}/AC-0${n}-${i}.spec.ts`,
      title: `AC-0${n}-${i}: t`,
    })),
    createdBy: "test",
    now: Date.now(),
  });

async function board(ctx: Ctx) {
  const res = await fetch(`${base}/api/projects/${ctx.projectId}/board`, { headers: ui });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    columns: string[];
    lanes: string[];
    cards: CardView[];
    items: ItemView[];
  };
}
const cardOf = async (ctx: Ctx, key: string) =>
  (await board(ctx)).cards.find((c) => c.key === key)!;

async function patch(ctx: Ctx, id: string, body: Record<string, unknown>, headers = ui) {
  const res = await fetch(`${base}/api/tasks/${id}`, {
    method: "PATCH",
    headers: { ...headers, "X-AM-Project": ctx.projectId },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
const reason = (body: Record<string, unknown>) =>
  body.error as { code: string; guard?: string; reason: string; details?: { reasonCode?: string } };

async function buildWorker(projectId: string): Promise<Client> {
  const client = new Client({ name: "test", version: "0" });
  const headers = {
    "X-AM-Token": "agent-t",
    "X-AM-Agent": "build",
    "X-AM-Project": projectId,
    "X-AM-Worker": "build-1",
  };
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }),
  );
  clients.push(client);
  return client;
}

describe("Done when: a human edit during a lease makes the agent's next write fail", () => {
  it("clears the lease, moves the card to Ready, sends three events, and the worker's heartbeat fails", async () => {
    const { ctx, ids } = await setup();
    await put(ctx, ids[0]!, {
      column: "In progress",
      leaseOwner: "build-1",
      leaseUntil: Date.now() + 600_000,
    });
    const worker = await buildWorker(ctx.projectId);
    const alive = (await worker.callTool({ name: "heartbeat", arguments: { itemId: ids[0] } })) as {
      isError?: boolean;
    };
    expect(alive.isError).toBeFalsy(); // the worker holds the lease

    const before = await cardOf(ctx, "CARD-01");
    const sent: Envelope[] = [];
    const off = events.on((e) => e.projectId === ctx.projectId && sent.push(e));
    const edited = await patch(ctx, ids[0]!, { version: before.version, title: "Book a slot" });
    off();
    expect(edited.status).toBe(200);
    expect(edited.body.task).toMatchObject({
      title: "Book a slot",
      column: "Ready",
      leaseHolder: null,
      leaseUntil: null,
      version: before.version + 1,
    });
    expect(sent.map((e) => e.type)).toEqual(["task.edited", "lease.changed", "task.moved"]);
    expect(sent[0]!.data).toMatchObject({ taskId: ids[0], fields: ["title"], actor: "human:ana" });
    expect(sent[1]!.data).toMatchObject({ itemId: ids[0], owner: null, reason: "cancel" });
    expect(sent[2]!.data).toMatchObject({ from: "In progress", to: "Ready" });

    const next = (await worker.callTool({ name: "heartbeat", arguments: { itemId: ids[0] } })) as {
      isError?: boolean;
      structuredContent?: { error?: { guard?: string; details?: { reasonCode?: string } } };
    };
    expect(next.isError).toBe(true);
    expect(next.structuredContent?.error).toMatchObject({
      guard: "lease",
      details: { reasonCode: "LEASE_ENDED" },
    });
    const [project] = await readQuery<{ p: { properties: { rejectedWrites: number } } }>(
      db,
      REGISTRY_GRAPH,
      "read/project",
      { projectId: ctx.projectId },
    );
    expect(project!.p.properties.rejectedWrites).toBe(1);
  });

  it("refuses an old version, and a PATCH with no project", async () => {
    const { ctx, ids } = await setup();
    const stale = await patch(ctx, ids[0]!, { version: 9, title: "x" });
    expect(stale.status).toBe(409);
    expect(reason(stale.body)).toMatchObject({ guard: "version" });
    expect((await cardOf(ctx, "CARD-01")).title).toBe("Card 1");
    // The version guard comes before the evidence guard (AGENTS.md rule 8).
    const staleMove = await patch(ctx, ids[0]!, { version: 9, column: "Ready" });
    expect(reason(staleMove.body)).toMatchObject({ guard: "version" });
    const res = await fetch(`${base}/api/tasks/${ids[0]}`, {
      method: "PATCH",
      headers: ui,
      body: JSON.stringify({ version: 1, title: "x" }),
    });
    expect(((await res.json()) as Record<string, unknown>).error).toMatchObject({
      guard: "tenancy",
    });
  });
});

describe("human moves (stage-machine.md section 6)", () => {
  it("H2 moves Backlog to Ready only when every criterion has a TestCase", async () => {
    const { ctx, ids } = await setup();
    const refused = await patch(ctx, ids[0]!, { version: 1, column: "Ready" });
    expect(refused.status).toBe(409);
    expect(reason(refused.body)).toMatchObject({
      guard: "evidence",
      details: { reasonCode: "NO_TESTS" },
    });
    expect(reason(refused.body).reason).toMatch(/AC-01-1, AC-01-2/);
    await cover(ctx, ids[0]!, 1); // moves it to Ready by itself; park it to try H2 again
    const ready = await cardOf(ctx, "CARD-01");
    expect(ready.column).toBe("Ready");
    const parked = await patch(ctx, ids[0]!, { version: ready.version, column: "Backlog" }); // H5
    expect(parked.body.task).toMatchObject({ column: "Backlog" });
    const back = await patch(ctx, ids[0]!, { version: ready.version + 1, column: "Ready" });
    expect(back.body.task).toMatchObject({ column: "Ready" });
  });

  it("H3 edits criteria: a Ready card goes to Rework with a write_tests item; a Backlog card stays", async () => {
    const { ctx, ids } = await setup();
    await cover(ctx, ids[0]!, 1);
    const ready = await cardOf(ctx, "CARD-01");
    const criteria = [
      { key: "AC-01-1", text: "Given one, when two, then three.", testIds: ["book-name"] },
      { key: "AC-01-3", text: "Given four, when five, then six.", testIds: ["book-phone"] },
      { key: "AC-01-4", text: "Given seven, when eight, then nine.", testIds: ["book-reason"] },
    ];
    const edited = await patch(ctx, ids[0]!, { version: ready.version, criteria });
    expect(edited.body.task).toMatchObject({ column: "Rework" });
    expect(
      (edited.body.task as CardView).criteria.map((k) => [k.key, k.text, k.testCaseCount]),
    ).toEqual([
      ["AC-01-1", "Given one, when two, then three.", 1],
      ["AC-01-3", "Given four, when five, then six.", 0],
      ["AC-01-4", "Given seven, when eight, then nine.", 0],
    ]);
    // AC-01-2 lost its edge but the node stays.
    expect(
      await db
        .selectGraph(ctx.graph)
        .roQuery(q("MATCH", "(k:AcceptanceCriterion {key: 'AC-01-2'})", "RETURN", "count(k) AS n"))
        .then((r) => r.data),
    ).toEqual([{ n: 1 }]);
    const items = (await board(ctx)).items.filter((i) => i.kind === "write_tests");
    expect(items).toHaveLength(1);

    // CARD-02 cannot take over a criterion of CARD-01.
    const foreign = await patch(ctx, ids[1]!, { version: 1, criteria: criteria.slice(0, 1) });
    expect(foreign.status).toBe(400);
    expect(reason(foreign.body).reason).toMatch(/AC-01-1 is not a criterion of CARD-02/);

    const backlog = await patch(ctx, ids[1]!, {
      version: 1,
      criteria: [{ key: "AC-02-1", text: "Given a, when b, then c.", testIds: ["book-name"] }],
    });
    expect(backlog.body.task).toMatchObject({ column: "Backlog" });
    const done = (await cardOf(ctx, "CARD-03")).version;
    await put(ctx, ids[2]!, { column: "Done" });
    const closed = await patch(ctx, ids[2]!, { version: done + 1, criteria });
    expect(closed.status).toBe(400); // H3: any column except Done
  });

  it("H4 reopens only a Done card, H5 parks only a Ready card, H6 unblocks only a blocked card", async () => {
    const { ctx, ids } = await setup();
    expect((await patch(ctx, ids[0]!, { version: 1, column: "Rework" })).status).toBe(400);
    await put(ctx, ids[0]!, { column: "Done" });
    expect((await patch(ctx, ids[0]!, { version: 2, column: "Rework" })).body.task).toMatchObject({
      column: "Rework",
    });
    expect((await patch(ctx, ids[1]!, { version: 1, column: "Backlog" })).status).toBe(400);
    expect((await patch(ctx, ids[1]!, { version: 1, unblock: true })).status).toBe(400);
    await put(ctx, ids[1]!, { attempts: 2 });
    expect((await cardOf(ctx, "CARD-02")).blocked).toBe(true);
    const unblocked = await patch(ctx, ids[1]!, { version: 2, unblock: true });
    expect(unblocked.body.task).toMatchObject({ attempts: 0, blocked: false });
  });

  it("H7 refuses a move into In progress, Testing or Done", async () => {
    const { ctx, ids } = await setup();
    for (const column of ["In progress", "Testing", "Done"]) {
      const res = await patch(ctx, ids[0]!, { version: 1, column });
      expect(res.status).toBe(400);
    }
  });
});

describe("board, progress and retry (routes 12, 14, 15, 31)", () => {
  it("shows every card with its fields, the CRs that flagged it, and the agent strip items", async () => {
    const { ctx, ids, facts } = await setup();
    await cover(ctx, ids[0]!, 1);
    const now = Date.now();
    const { changeRequest } = await createChangeRequest(ctx, {
      text: "Rule 1 is B.",
      createdBy: "human:ana",
      now,
    });
    await supersedeFacts(ctx, {
      crId: changeRequest.id,
      status: "applied",
      changes: [{ oldFactId: facts[0]!, statement: "Clinic rule 1 is B.", value: "B" }],
      createdBy: "proposal",
      now,
    });
    await flagImpact(ctx, { crId: changeRequest.id, factIds: [facts[0]!] });
    const blocked = (await openItem(ctx, {
      kind: "replan",
      subjectId: changeRequest.id,
      createdBy: "proposal",
      now,
    }))!;
    await put(ctx, blocked.id, { status: "blocked", attempts: 3 });

    const snapshot = await board(ctx);
    expect(snapshot.columns).toEqual([
      "Backlog",
      "Ready",
      "In progress",
      "Testing",
      "Done",
      "Rework",
    ]);
    expect(snapshot.lanes).toEqual(["Frontend", "Backend", "UI", "Tests", "Deployment"]);
    const one = snapshot.cards.find((c) => c.key === "CARD-01")!;
    expect(one).toMatchObject({
      column: "Rework",
      rework: true,
      crIds: [changeRequest.id],
      crKeys: ["CR-1"],
      testStatus: "pending",
      blocked: false,
      leaseHolder: null,
      requirementKey: "REQ-01",
      commits: [],
      gate: null,
    });
    expect(one.criteria.map((k) => k.testCaseCount)).toEqual([1, 1]);
    expect(snapshot.cards.find((c) => c.key === "CARD-04")).toMatchObject({
      column: "Backlog",
      testStatus: "none",
      crKeys: [],
    });
    expect(snapshot.items.find((i) => i.id === blocked.id)).toMatchObject({
      kind: "replan",
      agent: "planner",
      status: "blocked",
      attempts: 3,
    });
  });

  it("counts done cards per lane and lists a metric's nodes", async () => {
    const { ctx, ids } = await setup();
    await put(ctx, ids[0]!, { column: "Done" });
    const res = await fetch(`${base}/api/projects/${ctx.projectId}/progress`, { headers: ui });
    const progress = (await res.json()) as ProgressView;
    expect(progress.stage).toBe("build");
    expect(progress.gates.map((g) => g.key)).toEqual(["G1", "G2", "G3", "G5"]);
    expect(progress.lanes).toEqual(
      expect.arrayContaining([
        { lane: "Backend", done: 1, total: 3 },
        { lane: "Frontend", done: 0, total: 1 },
      ]),
    );
    expect(progress.coverage).toEqual({ covered: 0, total: 2 });
    expect(progress.openDefects).toBe(0);
    const lane = await fetch(`${base}/api/projects/${ctx.projectId}/progress/lane:Backend`, {
      headers: ui,
    });
    const { nodes } = (await lane.json()) as { nodes: { label: string; key: string }[] };
    expect(nodes.map((n) => [n.label, n.key])).toEqual([
      ["Task", "CARD-01"],
      ["Task", "CARD-02"],
      ["Task", "CARD-03"],
    ]);
    const bad = await fetch(`${base}/api/projects/${ctx.projectId}/progress/lane:Nope`, {
      headers: ui,
    });
    expect(bad.status).toBe(400);
  });

  it("sets a blocked item back to open with attempts 0, and refuses one that is not blocked", async () => {
    const { ctx } = await setup();
    const item = (await openItem(ctx, {
      kind: "planner",
      createdBy: "human:test",
      now: Date.now(),
    }))!;
    const retry = () =>
      fetch(`${base}/api/items/${item.id}/retry`, {
        method: "POST",
        headers: { ...ui, "X-AM-Project": ctx.projectId },
        body: "{}",
      });
    expect((await retry()).status).toBe(400);
    await put(ctx, item.id, { status: "blocked", attempts: 3 });
    const res = await retry();
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { item: { status: string; attempts: number } }).item,
    ).toMatchObject({
      status: "open",
      attempts: 0,
    });
  });
});
