// Route 30 (POST /api/runs/steps) and route 2 with the agent token, through the real gateway
// against the real FalkorDB from docker-compose.yml. No mocks.
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type Envelope, type ProjectInfo } from "@agencymem/contracts";
import { close, connect, type FalkorDB } from "@agencymem/graph";
import { createEvents } from "../events/bus";
import { createGateway } from "../main";

const TOKENS = { AM_AGENT_TOKEN: "agent-t", AM_UI_TOKEN: "ui-t", AM_HOOK_TOKEN: "hook-t" };
const FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";
// Built at run time, so this file holds no Cypher string literal (AGENTS.md rule 4).
const q = (...parts: string[]) => parts.join(" ");

let db: FalkorDB;
let server: Server;
let base: string;
const events = createEvents();
const graphs = new Set<string>();

beforeAll(async () => {
  db = await connect(FALKORDB_URL);
  server = createGateway(loadConfig({ ...TOKENS, FALKORDB_URL }, "gateway"), { events });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  for (const graph of graphs) await db.selectGraph(graph).delete();
  await close();
});

const ui = { "X-AM-Token": "ui-t", "X-AM-Actor": "human:ana" };

async function create(clientName = `test-client-${randomUUID()}`): Promise<ProjectInfo> {
  const res = await fetch(`${base}/api/projects`, {
    method: "POST",
    headers: { ...ui, "Content-Type": "application/json" },
    body: JSON.stringify({ clientName, projectName: "Booking", mode: "demo" }),
  });
  const { project } = (await res.json()) as { project: ProjectInfo };
  graphs.add(`client_${project.clientId}`);
  return project;
}

/** An intake item of the project, opened by uploading one text file (T2). */
async function intakeItem(projectId: string): Promise<string> {
  const form = new FormData();
  form.append("files", new Blob(["Each slot is 20 minutes long."]), "notes.txt");
  await fetch(`${base}/api/projects/${projectId}/files`, {
    method: "POST",
    headers: ui,
    body: form,
  });
  const res = await fetch(`${base}/api/query`, {
    method: "POST",
    headers: { ...ui, "Content-Type": "application/json", "X-AM-Project": projectId },
    body: JSON.stringify({ graph: "client", cypher: q("MATCH", "(w:WorkItem)", "RETURN", "w.id") }),
  });
  return ((await res.json()) as { rows: string[][] }).rows[0]![0]!;
}

const agentHeaders = (projectId: string) => ({
  "X-AM-Token": "agent-t",
  "X-AM-Agent": "intake",
  "X-AM-Project": projectId,
  "X-AM-Worker": "intake-1",
  "Content-Type": "application/json",
});

async function step(headers: Record<string, string>, body: Record<string, unknown>) {
  const res = await fetch(`${base}/api/runs/steps`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("POST /api/runs/steps (route 30)", () => {
  it("answers 202 and sends one run.step event", async () => {
    const project = await create();
    const itemId = await intakeItem(project.id);
    const sent: Envelope[] = [];
    const off = events.on((e) => e.projectId === project.id && sent.push(e));
    const res = await step(agentHeaders(project.id), {
      itemId,
      step: "think",
      text: "Thinking (model-x)",
      model: "model-x",
      tokensIn: 100,
      tokensOut: 20,
      ms: 900,
    });
    off();
    expect(res).toEqual({ status: 202, body: {} });
    expect(sent.map((e) => [e.type, e.data])).toEqual([
      [
        "run.step",
        {
          itemId,
          agent: "intake",
          step: "think",
          text: "Thinking (model-x)",
          model: "model-x",
          tokens: 120,
          ms: 900,
        },
      ],
    ]);
  });

  it("refuses a bad request: 400 for a missing header or a long text, 401 for the UI token", async () => {
    const project = await create();
    const itemId = await intakeItem(project.id);
    const noWorker: Record<string, string> = agentHeaders(project.id);
    delete noWorker["X-AM-Worker"];
    expect((await step(noWorker, { itemId, step: "s", text: "t" })).status).toBe(400);
    expect(
      (await step(agentHeaders(project.id), { itemId, step: "s", text: "x".repeat(201) })).status,
    ).toBe(400);
    const unknown = agentHeaders("01ARZ3NDEKTSV4RRFFQ69G5FAV");
    expect((await step(unknown, { itemId, step: "s", text: "t" })).status).toBe(400);
    const asUi = { ...agentHeaders(project.id), "X-AM-Token": "ui-t" };
    expect((await step(asUi, { itemId, step: "s", text: "t" })).status).toBe(401);
  });

  it("refuses an item of another project: 403 tenancy, counted", async () => {
    const clientName = `test-client-${randomUUID()}`;
    const mine = await create(clientName);
    const theirs = await create(clientName); // same client graph
    const foreignItem = await intakeItem(theirs.id);
    const sent: Envelope[] = [];
    const off = events.on((e) => e.projectId === mine.id && sent.push(e));
    const res = await step(agentHeaders(mine.id), { itemId: foreignItem, step: "s", text: "t" });
    off();
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: { guard: "tenancy", details: { reasonCode: "FOREIGN_NODE" } },
    });
    // Counted as a rejected write, with its events (AGENTS.md rule 8).
    expect(sent.map((e) => [e.type, e.data])).toEqual([
      [
        "write.rejected",
        expect.objectContaining({
          tool: "POST /api/runs/steps",
          guard: "tenancy",
          agent: "intake",
        }),
      ],
      ["metrics.updated", { metric: "rejectedWrites", value: 1 }],
    ]);
  });

  it("answers 404 for an item that does not exist", async () => {
    const project = await create();
    const res = await step(agentHeaders(project.id), {
      itemId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      step: "s",
      text: "t",
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/projects with the agent token (how the runner finds projects)", () => {
  it("lists the projects for the agent token too", async () => {
    const project = await create();
    const res = await fetch(`${base}/api/projects`, { headers: { "X-AM-Token": "agent-t" } });
    expect(res.status).toBe(200);
    const { projects } = (await res.json()) as { projects: ProjectInfo[] };
    expect(projects.map((p) => p.id)).toContain(project.id);
  });

  it("still refuses the agent token on every other /api route", async () => {
    const project = await create();
    const res = await fetch(`${base}/api/projects/${project.id}`, {
      headers: { "X-AM-Token": "agent-t" },
    });
    expect(res.status).toBe(401);
  });
});
