// Task 3.10, Done when: a click on a card shows its path to the client's words. Routes 16, 17 and
// 18 of contracts.md section 8 through the real gateway against the real FalkorDB from
// docker-compose.yml. No mocks.
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GraphView, PathResponse, loadConfig } from "@agencymem/contracts";
import { close, connect, type FalkorDB } from "@agencymem/graph";
import {
  createGates,
  createProject,
  deleteTestClient,
  writeCards,
  writeDesign,
  writeDocument,
  writeFacts,
  writeProduct,
  type Ctx,
} from "@agencymem/memory";
import { createEvents } from "../events/bus";
import { createGateway } from "../main";

const TOKENS = { AM_AGENT_TOKEN: "agent-t", AM_UI_TOKEN: "ui-t", AM_HOOK_TOKEN: "hook-t" };
const FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";
const headers = { "X-AM-Token": "ui-t", "X-AM-Actor": "human:ana" };

let db: FalkorDB;
let server: Server;
let base: string;
const graphs = new Set<string>();

beforeAll(async () => {
  db = await connect(FALKORDB_URL);
  server = createGateway(loadConfig({ ...TOKENS, FALKORDB_URL }, "gateway"), {
    events: createEvents(),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  for (const graph of graphs) await deleteTestClient(db, graph);
  await close();
});

/** Document → Episode ← Fact ← REQ-01 ← CARD-01, with EP-01 and two criteria on the card. */
async function setup(clientName = `test-client-${randomUUID()}`) {
  const now = Date.now();
  const { project, client } = await createProject(db, {
    clientName,
    projectName: "Graph",
    mode: "demo",
    createdBy: "human:test",
    now,
  });
  const ctx: Ctx = { db, graph: `client_${client.id}`, projectId: project.id };
  graphs.add(ctx.graph);
  await createGates(ctx, { keys: ["G1"], createdBy: "human:test", now });
  const { episodeIds } = await writeDocument(ctx, {
    name: "kickoff-notes.pdf",
    mime: "application/pdf",
    sha256: "c".repeat(64),
    status: "processed",
    wordCount: 8,
    error: null,
    episodes: [{ page: 1, lineStart: 3, lineEnd: 4, text: "A slot is 20 minutes." }],
    createdBy: "human:test",
    now,
  });
  const { factIds } = await writeFacts(ctx, {
    entities: [{ key: "slot", name: "Slot", aliases: [] }],
    facts: [
      {
        statement: "A slot is 20 minutes.",
        subject: "slot",
        attribute: "length",
        value: "20",
        episodeIds,
        replacesFactId: null,
      },
    ],
    createdBy: "intake",
    now,
  });
  await writeProduct(ctx, {
    baseVersion: 0,
    requirements: [{ key: "REQ-01", text: "A patient books a slot.", priority: "must", factIds }],
    features: [
      {
        key: "FEAT-01",
        name: "Booking",
        featureKind: "form",
        requirementKeys: ["REQ-01"],
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
      {
        key: "CARD-01",
        title: "Book a slot",
        description: "The booking form.",
        lane: "Backend",
        order: 10,
        requirementKey: "REQ-01",
        designKeys: ["EP-01"],
        dependsOn: [],
        criteria: [1, 2].map((i) => ({
          key: `AC-01-${i}`,
          text: `Given part ${i}, when it runs, then it works.`,
          testIds: ["book-submit"],
        })),
      },
    ] as never,
    createdBy: "planner",
    now,
  }))!;
  return { ctx, taskId: taskIds[0]!, factId: factIds[0]!, episodeId: episodeIds[0]! };
}

const get = async (path: string) => {
  const res = await fetch(`${base}/api/projects/${path}`, { headers });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const labels = (view: GraphView) => new Set(view.nodes.map((n) => n.label));
const has = (view: GraphView, source: string, type: string, target: string) =>
  view.links.some((l) => l.source === source && l.type === type && l.target === target);

describe("GET /api/projects/:id/why/:nodeId", () => {
  it("returns a card's path to the client's words: Task → Requirement → Fact → Episode", async () => {
    const { ctx, taskId, factId, episodeId } = await setup();
    const res = await get(`${ctx.projectId}/why/${taskId}`);
    expect(res.status).toBe(200);
    const { path, ms } = PathResponse.parse(res.body);
    expect(ms).toBeGreaterThanOrEqual(0);
    // Criteria have no OF edge yet (write-cards.cypher), so they lead to no Episode.
    expect(labels(path)).toEqual(new Set(["Task", "Requirement", "Fact", "Episode", "Endpoint"]));
    const req = path.nodes.find((n) => n.label === "Requirement")!;
    expect(has(path, taskId, "IMPLEMENTS", req.id)).toBe(true);
    expect(has(path, req.id, "DERIVED_FROM", factId)).toBe(true);
    expect(has(path, factId, "SOURCED_FROM", episodeId)).toBe(true);
    const task = path.nodes.find((n) => n.id === taskId)!;
    expect(task).toMatchObject({ title: "CARD-01", group: "Delivery", state: null });
    expect(path.nodes.find((n) => n.id === factId)).toMatchObject({
      title: "A slot is 20 minutes.",
      group: "Knowledge",
    });
    // Every link joins two nodes of the path.
    const ids = new Set(path.nodes.map((n) => n.id));
    for (const l of path.links) expect(ids.has(l.source) && ids.has(l.target)).toBe(true);
  });

  it("answers an Episode with itself, and 404, 400 and FOREIGN_NODE for bad ids", async () => {
    const clientName = `test-client-${randomUUID()}`;
    const one = await setup(clientName);
    const two = await setup(clientName); // same client, same graph
    const res = await get(`${one.ctx.projectId}/why/${one.episodeId}`);
    expect(PathResponse.parse(res.body).path).toMatchObject({
      nodes: [{ id: one.episodeId, label: "Episode", group: "Sources" }],
      links: [],
    });
    expect((await get(`${one.ctx.projectId}/why/01ARZ3NDEKTSV4RRFFQ69G5FAV`)).status).toBe(404);
    expect((await get(`${one.ctx.projectId}/why/nope`)).status).toBe(400);
    const foreign = await get(`${two.ctx.projectId}/why/${one.taskId}`);
    expect(foreign.status).toBe(403);
    expect(foreign.body).toMatchObject({ error: { details: { reasonCode: "FOREIGN_NODE" } } });
  });
});

describe("GET /api/projects/:id/impact/:nodeId", () => {
  it("follows a fact to the cards built on it, and refuses a node that is not a Fact", async () => {
    const { ctx, taskId, factId } = await setup();
    const res = await get(`${ctx.projectId}/impact/${factId}`);
    expect(res.status).toBe(200);
    const { path } = PathResponse.parse(res.body);
    expect(labels(path)).toEqual(new Set(["Fact", "Requirement", "Endpoint", "Task"]));
    expect(path.nodes.some((n) => n.id === taskId)).toBe(true);
    expect((await get(`${ctx.projectId}/impact/${taskId}`)).status).toBe(400);
  });
});

describe("GET /api/projects/:id/graph", () => {
  it("returns the project's nodes and the links between them, all or around a focus", async () => {
    const { ctx, taskId, factId, episodeId } = await setup();
    const all = await get(`${ctx.projectId}/graph`);
    expect(all.status).toBe(200);
    const view = GraphView.parse(all.body);
    for (const l of ["Document", "Episode", "Fact", "Requirement", "Task", "Gate"]) {
      expect(labels(view).has(l)).toBe(true);
    }
    expect(has(view, factId, "SOURCED_FROM", episodeId)).toBe(true);
    const ids = new Set(view.nodes.map((n) => n.id));
    for (const l of view.links) expect(ids.has(l.source) && ids.has(l.target)).toBe(true);

    const limited = GraphView.parse((await get(`${ctx.projectId}/graph?limit=3`)).body);
    expect(limited.nodes).toHaveLength(3);

    // One hop from the card: its requirement, design node and criteria, not the fact.
    const near = GraphView.parse(
      (await get(`${ctx.projectId}/graph?focus=${taskId}&depth=1`)).body,
    );
    expect(labels(near)).toEqual(
      new Set(["Task", "Requirement", "Endpoint", "AcceptanceCriterion"]),
    );
    const far = GraphView.parse((await get(`${ctx.projectId}/graph?focus=${taskId}&depth=2`)).body);
    expect(far.nodes.some((n) => n.id === factId)).toBe(true);
    expect((await get(`${ctx.projectId}/graph?depth=9`)).status).toBe(400);
  });
});
