// The base REST routes through the real gateway against the real FalkorDB from docker-compose.yml.
// No mocks.
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ulid } from "ulid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type Envelope, type ProjectInfo } from "@agencymem/contracts";
import {
  REGISTRY_GRAPH,
  close,
  connect,
  graphFor,
  readQuery,
  type FalkorDB,
} from "@agencymem/graph";
import { openItem, deleteTestClient } from "@agencymem/memory";
import { createEvents } from "../events/bus";
import { createGateway } from "../main";

const TOKENS = { AM_AGENT_TOKEN: "agent-t", AM_UI_TOKEN: "ui-t", AM_HOOK_TOKEN: "hook-t" };
const FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";
const UNKNOWN = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
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

const ui = { "X-AM-Token": "ui-t", "Content-Type": "application/json" };
const actor = { "X-AM-Actor": "human:ana" };

async function api(method: string, path: string, body?: unknown, headers = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...ui, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function create(clientName: string, projectName = "Booking") {
  const res = await api("POST", "/api/projects", { clientName, projectName, mode: "demo" }, actor);
  const project = (res.body as { project?: ProjectInfo }).project;
  if (project) graphs.add(`client_${project.clientId}`);
  return { ...res, project: project! };
}

describe("Done when: creating a project makes its client graph usable", () => {
  it("writes Client and Project to the registry, and the new graph works for routing, tools and queries", async () => {
    const clientName = `test-client-${randomUUID()}`;
    const { status, project } = await create(clientName);
    expect(status).toBe(201);
    expect(project).toMatchObject({
      clientName,
      name: "Booking",
      mode: "demo",
      stage: "intake",
      productVersion: 0,
      designVersion: 0,
      clarity: null,
      closedAt: null,
    });

    // The router finds the client graph, and its schema is in place.
    const graph = await graphFor(db, project.id);
    expect(graph).toBe(`client_${project.clientId}`);
    const indexes = await readQuery<{ label: string }>(db, graph, "read/indexes", {});
    expect(indexes.map((i) => i.label)).toEqual(
      expect.arrayContaining(["WorkItem", "Fact", "Task"]),
    );

    // An agent session binds to the new project and works on an item there.
    const item = await openItem(
      { db, graph, projectId: project.id },
      { kind: "intake", subjectId: ulid(), createdBy: "human:ana", now: Date.now() },
    );
    const agent = new Client({ name: "test", version: "0" });
    await agent.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: {
          headers: {
            "X-AM-Token": "agent-t",
            "X-AM-Agent": "intake",
            "X-AM-Project": project.id,
            "X-AM-Worker": "intake-1",
          },
        },
      }),
    );
    clients.push(agent);
    const claimed = await agent.callTool({ name: "claim_item", arguments: {} });
    expect(claimed.structuredContent).toMatchObject({ item: { id: item!.id, status: "claimed" } });

    // A read query on the project's graph sees it.
    const query = await api(
      "POST",
      "/api/query",
      { graph: "client", cypher: q("MATCH", "(w:WorkItem)", "RETURN", "count(w) AS n") },
      { "X-AM-Project": project.id },
    );
    expect(query.status).toBe(200);
    expect(query.body).toMatchObject({ columns: ["n"], rows: [[1]], truncated: false });
  });

  it("puts a second project of the same client in the same client graph", async () => {
    const clientName = `test-client-${randomUUID()}`;
    const first = await create(clientName, "Booking");
    const second = await create(clientName, "Portal");
    expect(second.project.clientId).toBe(first.project.clientId);
    expect(second.project.id).not.toBe(first.project.id);
  });

  it("sends node.written for the new Project on its own stream", async () => {
    const sent: Envelope[] = [];
    const off = events.on((e) => sent.push(e));
    const { project } = await create(`test-client-${randomUUID()}`);
    off();
    // The Project, then the four Gates that T1 creates in one write.
    expect(sent.filter((e) => e.projectId === project.id)).toEqual([
      expect.objectContaining({
        type: "node.written",
        data: expect.objectContaining({ label: "Project", id: project.id, version: 1 }),
      }),
      expect.objectContaining({
        type: "node.written",
        data: expect.objectContaining({ label: "Gate", ids: expect.any(Array) }),
      }),
    ]);
  });
});

describe("POST /api/projects", () => {
  it("needs X-AM-Actor and a valid body", async () => {
    const body = { clientName: "C", projectName: "P", mode: "demo" };
    const noActor = await api("POST", "/api/projects", body);
    expect(noActor.status).toBe(400);
    expect(noActor.body).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
    const bad = await api("POST", "/api/projects", { ...body, mode: "prod" }, actor);
    expect(bad.status).toBe(400);
    for (const empty of [{ clientName: "" }, { projectName: "" }]) {
      const res = await api("POST", "/api/projects", { ...body, ...empty }, actor);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
    }
  });
});

describe("GET /api/projects and GET /api/projects/:id", () => {
  it("lists projects, and returns one project with the seq its snapshot reflects", async () => {
    const { project } = await create(`test-client-${randomUUID()}`);
    const list = await api("GET", "/api/projects");
    expect(list.status).toBe(200);
    expect((list.body.projects as ProjectInfo[]).map((p) => p.id)).toContain(project.id);

    const one = await api("GET", `/api/projects/${project.id}`);
    expect(one.status).toBe(200);
    expect(one.body).toEqual({ project, seq: events.current(project.id) });
  });

  it("answers 400 for an id that is not an id, and 404 for an unknown project", async () => {
    expect((await api("GET", "/api/projects/nope")).status).toBe(400);
    const unknown = await api("GET", `/api/projects/${UNKNOWN}`);
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});

describe("POST /api/query", () => {
  const read = { graph: "client", cypher: q("MATCH", "(n)", "RETURN", "count(n) AS n") };

  it("needs a known X-AM-Project (tenancy, not counted)", async () => {
    const missing = await api("POST", "/api/query", read);
    expect(missing.status).toBe(403);
    expect(missing.body).toMatchObject({
      error: { guard: "tenancy", details: { reasonCode: "PROJECT_MISSING" } },
    });
    const unknown = await api("POST", "/api/query", read, { "X-AM-Project": UNKNOWN });
    expect(unknown.status).toBe(403);
    expect(unknown.body).toMatchObject({ error: { details: { reasonCode: "PROJECT_UNKNOWN" } } });
  });

  it("rejects a write clause, counted as a rejected query, with a write.rejected event", async () => {
    const { project } = await create(`test-client-${randomUUID()}`);
    const sent: Envelope[] = [];
    const off = events.on((e) => sent.push(e));
    const res = await api(
      "POST",
      "/api/query",
      { graph: "client", cypher: q("MATCH", "(n)", "SET", "n.x = 1") },
      { "X-AM-Project": project.id, ...actor },
    );
    off();
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: { guard: "read-only", details: { reasonCode: "WRITE_CLAUSE" } },
    });
    const [row] = await readQuery<{ p: { properties: { rejectedQueries: number } } }>(
      db,
      REGISTRY_GRAPH,
      "read/project",
      { projectId: project.id },
    );
    expect(row!.p.properties.rejectedQueries).toBe(1);
    expect(sent.map((e) => [e.type, e.data])).toEqual([
      [
        "write.rejected",
        expect.objectContaining({
          tool: "POST /api/query",
          guard: "read-only",
          agent: "human:ana",
        }),
      ],
      ["metrics.updated", { metric: "rejectedQueries", value: 1 }],
    ]);
  });
});
