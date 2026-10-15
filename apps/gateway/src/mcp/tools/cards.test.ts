// write_cards (task 3.6) through the real gateway (MCP SDK client) against the real FalkorDB from
// docker-compose.yml. No mocks.
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type Envelope } from "@agencymem/contracts";
import { REGISTRY_GRAPH, close, connect, readQuery, type FalkorDB } from "@agencymem/graph";
import {
  createGates,
  createProject,
  deleteTestClient,
  openItem,
  writeDesign,
  writeDocument,
  writeFacts,
  writeCards,
  writeProduct,
  writeVersioned,
  type Ctx,
} from "@agencymem/memory";
import { createEvents } from "../../events/bus";
import { createGateway } from "../../main";

const TOKENS = { AM_AGENT_TOKEN: "agent-t", AM_UI_TOKEN: "ui-t", AM_HOOK_TOKEN: "hook-t" };
const FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";
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
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});
afterAll(async () => {
  await Promise.allSettled(clients.map((c) => c.close()));
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  for (const graph of graphs) await deleteTestClient(db, graph);
  await close();
});

/** A project with REQ-01..02, EP-01 and SCR-01, G3 approved (unless `g3` is false), a planner item. */
async function setup({ g3 = true } = {}) {
  const now = Date.now();
  const { project, client } = await createProject(db, {
    clientName: `test-client-${randomUUID()}`,
    projectName: "Cards",
    mode: "demo",
    createdBy: "human:test",
    now,
  });
  const ctx: Ctx = { db, graph: `client_${client.id}`, projectId: project.id };
  graphs.add(ctx.graph);
  const gates = await createGates(ctx, {
    keys: ["G1", "G2", "G3", "G5"],
    createdBy: "human:test",
    now,
  });
  const gate3 = gates.find((g) => g.key === "G3")!;
  if (g3) {
    await writeVersioned(ctx, {
      id: gate3.id,
      version: gate3.version,
      props: { status: "approved", decidedBy: "human:test", decidedAt: now },
    });
  }
  const { episodeIds } = await writeDocument(ctx, {
    name: "kickoff-notes.pdf",
    mime: "application/pdf",
    sha256: "c".repeat(64),
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
      {
        label: "Screen",
        key: "SCR-01",
        name: "Book page",
        body: "Uses book-name.",
        requirementKeys: ["REQ-02"],
      },
    ],
    sections: [],
    createdBy: "architect",
    now,
  });
  const item = (await openItem(ctx, { kind: "planner", createdBy: "human:test", now }))!;
  return { ctx, item };
}

async function agent(projectId: string, agentId = "planner"): Promise<Client> {
  const client = new Client({ name: "test", version: "0" });
  const headers = {
    "X-AM-Token": "agent-t",
    "X-AM-Agent": agentId,
    "X-AM-Project": projectId,
    "X-AM-Worker": `${agentId}-1`,
  };
  await client.connect(
    new StreamableHTTPClientTransport(new URL(base), { requestInit: { headers } }),
  );
  clients.push(client);
  return client;
}

type Result = { isError?: boolean; structuredContent?: Record<string, unknown> };
async function call(client: Client, args: Record<string, unknown>) {
  const result = (await client.callTool({ name: "write_cards", arguments: args })) as Result;
  return { isError: result.isError === true, out: result.structuredContent ?? {} };
}
const error = (out: Record<string, unknown>) =>
  out.error as { code: string; guard?: string; details?: Record<string, unknown> };
const rows = (ctx: Ctx, cypher: string) =>
  db
    .selectGraph(ctx.graph)
    .roQuery(cypher)
    .then((r) => (r.data ?? []) as Record<string, unknown>[]);

const card = (n: number, over: Record<string, unknown> = {}) => ({
  key: `CARD-0${n}`,
  title: `Card ${n}`,
  description: `Builds part ${n}.`,
  lane: n === 1 ? "Backend" : "Frontend",
  order: n * 10,
  requirementKey: n === 1 ? "REQ-01" : "REQ-02",
  designKeys: n === 1 ? ["EP-01"] : ["SCR-01", "EP-01"],
  dependsOn: n === 1 ? [] : ["CARD-01"],
  criteria: [
    {
      key: `AC-0${n}-1`,
      text: `Given part ${n}, when \`book-submit\` is pressed, then \`booking-code\` shows.`,
      testIds: ["book-submit", "booking-code"],
    },
  ],
  ...over,
});
const cards = (itemId: string, list = [card(1), card(2)]) => ({
  itemId,
  mode: "create",
  cards: list,
});

describe("write_cards: guards", () => {
  it("rejects a write while G3 is not approved, and counts it", async () => {
    const { ctx, item } = await setup({ g3: false });
    const res = await call(await agent(ctx.projectId), cards(item.id));
    expect(error(res.out)).toMatchObject({
      guard: "gate",
      details: { reasonCode: "GATE_NOT_APPROVED" },
    });
    const [project] = await readQuery<{ p: { properties: { rejectedWrites: number } } }>(
      db,
      REGISTRY_GRAPH,
      "read/project",
      { projectId: ctx.projectId },
    );
    expect(project!.p.properties.rejectedWrites).toBe(1);
  });

  it("rejects an agent that does not own cards", async () => {
    const { ctx, item } = await setup();
    const res = await call(await agent(ctx.projectId, "architect"), cards(item.id));
    expect(error(res.out)).toMatchObject({ guard: "ownership" });
  });

  it("rejects an unknown requirement or design key (source)", async () => {
    const { ctx, item } = await setup();
    const planner = await agent(ctx.projectId);
    const noReq = await call(planner, cards(item.id, [card(1, { requirementKey: "REQ-09" })]));
    expect(error(noReq.out)).toMatchObject({
      guard: "source",
      details: { reasonCode: "SOURCE_UNKNOWN" },
    });
    const noDesign = await call(planner, cards(item.id, [card(1, { designKeys: ["CMP-09"] })]));
    expect(error(noDesign.out)).toMatchObject({ guard: "source" });
  });

  it("rejects a cycle with the cycle in details, an unknown dependency and repeated keys", async () => {
    const { ctx, item } = await setup();
    const planner = await agent(ctx.projectId);
    const cycle = await call(
      planner,
      cards(item.id, [card(1, { dependsOn: ["CARD-02"] }), card(2)]),
    );
    expect(error(cycle.out)).toMatchObject({
      code: "VALIDATION_FAILED",
      details: { cycle: ["CARD-01", "CARD-02", "CARD-01"] },
    });
    const unknown = await call(planner, cards(item.id, [card(2)]));
    expect(error(unknown.out)).toMatchObject({ code: "VALIDATION_FAILED" });
    const twice = await call(planner, cards(item.id, [card(1), card(1)]));
    expect(error(twice.out)).toMatchObject({ code: "VALIDATION_FAILED" });
    const criterionTwice = await call(
      planner,
      cards(item.id, [card(1), card(2, { criteria: card(1).criteria })]),
    );
    expect(error(criterionTwice.out)).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await rows(ctx, q("MATCH", "(t:Task)", "RETURN", "count(t) AS n"))).toEqual([{ n: 0 }]);
  });

  it("refuses update mode until replan is built", async () => {
    const { ctx, item } = await setup();
    const res = await call(await agent(ctx.projectId), {
      ...cards(item.id),
      mode: "update",
      cards: [{ ...card(1), version: 1 }],
    });
    expect(error(res.out)).toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("write_cards: create", () => {
  it("writes Backlog cards with their edges and events, then refuses the same keys again", async () => {
    const { ctx, item } = await setup();
    const planner = await agent(ctx.projectId);
    const sent: Envelope[] = [];
    const off = events.on((e) => e.projectId === ctx.projectId && sent.push(e));
    const res = await call(planner, cards(item.id));
    off();
    expect(res.out.error).toBeUndefined();
    const taskIds = res.out.taskIds as string[];
    const criterionIds = res.out.criterionIds as string[];
    expect(taskIds).toHaveLength(2);
    expect(criterionIds).toHaveLength(2);

    expect(
      await rows(
        ctx,
        q(
          "MATCH",
          "(t:Task)-[:IMPLEMENTS]->(r:Requirement)",
          "OPTIONAL MATCH",
          "(t)-[:USES]->(d)",
          "WITH",
          "t, r, collect(d.key) AS uses",
          "OPTIONAL MATCH",
          "(t)-[:DEPENDS_ON]->(x:Task)",
          "WITH",
          "t, r, uses, collect(x.key) AS deps",
          "OPTIONAL MATCH",
          "(t)-[:HAS_CRITERION]->(c:AcceptanceCriterion)",
          "RETURN",
          "t.id AS id, t.key AS key, t.column AS col, t.kind AS kind, t.lane AS lane,",
          "t.order AS ord, t.version AS v, t.attempts AS attempts, r.key AS req, uses, deps,",
          "collect(c.id) AS criteria, collect(c.testIds) AS testIds",
          "ORDER BY key",
        ),
      ),
    ).toEqual([
      {
        id: taskIds[0],
        key: "CARD-01",
        col: "Backlog",
        kind: "build",
        lane: "Backend",
        ord: 10,
        v: 1,
        attempts: 0,
        req: "REQ-01",
        uses: ["EP-01"],
        deps: [],
        criteria: [criterionIds[0]],
        testIds: [["book-submit", "booking-code"]],
      },
      {
        id: taskIds[1],
        key: "CARD-02",
        col: "Backlog",
        kind: "build",
        lane: "Frontend",
        ord: 20,
        v: 1,
        attempts: 0,
        req: "REQ-02",
        uses: expect.arrayContaining(["SCR-01", "EP-01"]),
        deps: ["CARD-01"],
        criteria: [criterionIds[1]],
        testIds: [["book-submit", "booking-code"]],
      },
    ]);

    const written = sent.filter((e) => e.type === "node.written").map((e) => e.data);
    expect(written).toEqual([
      expect.objectContaining({ label: "Task", id: taskIds[0], ids: taskIds }),
      expect.objectContaining({ label: "AcceptanceCriterion", ids: criterionIds }),
    ]);
    expect(sent.filter((e) => e.type === "task.moved").map((e) => e.data)).toEqual([
      expect.objectContaining({ taskId: taskIds[0], key: "CARD-01", from: null, to: "Backlog" }),
      expect.objectContaining({ taskId: taskIds[1], key: "CARD-02", from: null, to: "Backlog" }),
    ]);

    const again = await call(planner, cards(item.id, [card(1)]));
    expect(error(again.out)).toMatchObject({ code: "VALIDATION_FAILED" });
    // The query refuses on its own too (a race past the gateway's checks): a taken key, or a
    // requirement that is not current.
    const direct = (c: Record<string, unknown>) =>
      writeCards(ctx, { cards: [c as never], createdBy: "planner", now: Date.now() });
    expect(await direct(card(1))).toBeNull();
    expect(await direct(card(3, { requirementKey: "REQ-09", dependsOn: [] }))).toBeNull();
    expect(await rows(ctx, q("MATCH", "(t:Task)", "RETURN", "count(t) AS n"))).toEqual([{ n: 2 }]);
  });
});
