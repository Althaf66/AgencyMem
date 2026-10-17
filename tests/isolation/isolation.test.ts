// Task 6.3, Done when: 0 foreign nodes; the unknown id fails. Two clients, each with its own graph
// and nodes; every read from one project (route 23, the read_query tool, route 6, live events)
// sees none of the other client's nodes, and a project id the registry does not know fails on
// every path. Real gateway and FalkorDB from docker-compose.yml; no mocks.
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type ProjectInfo, type ServerMessage } from "@agencymem/contracts";
import { UnknownProjectError, close, connect, graphFor, type FalkorDB } from "@agencymem/graph";
import { deleteTestClient, openItem, writeDocument, writeFacts, type Ctx } from "@agencymem/memory";
import { createGateway } from "../../apps/gateway/src/main";
import { openSession, type Session } from "../../apps/runner/src/mcp-client";

const TOKENS = { AM_AGENT_TOKEN: "agent-t", AM_UI_TOKEN: "ui-t", AM_HOOK_TOKEN: "hook-t" };
const FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";
// A well-formed project id that the registry never holds.
const UNKNOWN = "01J0000000000000000000ZZZZ";
const ui = { "X-AM-Token": "ui-t", "X-AM-Actor": "human:ana", "Content-Type": "application/json" };

let db: FalkorDB;
let server: Server;
let base: string;
const graphs = new Set<string>();
const sessions: Session[] = [];
const sockets: WebSocket[] = [];

beforeAll(async () => {
  db = await connect(FALKORDB_URL);
  server = createGateway(loadConfig({ ...TOKENS, FALKORDB_URL }, "gateway"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  for (const ws of sockets) ws.close();
  await Promise.allSettled(sessions.map((s) => s.close()));
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  for (const graph of graphs) await deleteTestClient(db, graph);
  await close();
});

type Tenant = { ctx: Ctx; ids: string[] };

/** A new client and project through route 1, with a document, episodes, an entity and facts. */
async function tenant(name: string): Promise<Tenant> {
  const res = await fetch(`${base}/api/projects`, {
    method: "POST",
    headers: ui,
    body: JSON.stringify({
      clientName: `test-client-${name}-${randomUUID()}`,
      projectName: `${name} booking`,
      mode: "demo",
    }),
  });
  expect(res.status).toBe(201);
  const { project } = (await res.json()) as { project: ProjectInfo };
  const ctx: Ctx = { db, graph: `client_${project.clientId}`, projectId: project.id };
  graphs.add(ctx.graph);
  const now = Date.now();
  const { episodeIds } = await writeDocument(ctx, {
    name: `${name}-notes.pdf`,
    mime: "application/pdf",
    sha256: randomUUID().replaceAll("-", "").padEnd(64, "0"),
    status: "processed",
    wordCount: 6,
    error: null,
    episodes: [
      { page: 1, lineStart: 1, lineEnd: 1, text: `${name} opens at 9.` },
      { page: 1, lineStart: 2, lineEnd: 2, text: `${name} has two doctors.` },
    ],
    createdBy: "human:test",
    now,
  });
  await writeFacts(ctx, {
    entities: [{ key: "clinic", name: `${name} clinic`, aliases: [] }],
    facts: [
      {
        statement: `${name} clinic opens at 9.`,
        subject: "clinic",
        attribute: "opening_time",
        value: "09:00",
        episodeIds: [episodeIds[0]!],
        replacesFactId: null,
      },
      {
        statement: `${name} clinic has two doctors.`,
        subject: "clinic",
        attribute: "doctors",
        value: "2",
        episodeIds: [episodeIds[1]!],
        replacesFactId: null,
      },
    ],
    createdBy: "intake",
    now,
  });
  const { rows } = await query(ctx.projectId, ALL_IDS);
  return { ctx, ids: rows.map((r) => r[0] as string) };
}

// Built at run time, so this file holds no Cypher string literal (AGENTS.md rule 4).
const q = (...parts: string[]) => parts.join(" ");
const ALL_IDS = q("MATCH", "(n)", "RETURN", "n.id");
const ALL = q("MATCH", "(n)", "RETURN", "n.id, n.projectId");
const BY_ID = q("MATCH", "(n {id: $id})", "RETURN", "n.id");

/** Route 23 on the project's client graph. */
async function query(projectId: string, cypher: string, params?: Record<string, unknown>) {
  const res = await fetch(`${base}/api/query`, {
    method: "POST",
    headers: { ...ui, "X-AM-Project": projectId },
    body: JSON.stringify({ graph: "client", cypher, ...(params ? { params } : {}) }),
  });
  return {
    status: res.status,
    ...((await res.json()) as { rows: unknown[][]; error?: { code: string; details?: unknown } }),
  };
}

/** An MCP session on the project: an agent's, or with the UI token a UI one (only read_query). */
async function mcp(projectId: string, token: "agent-t" | "ui-t", agentId: "intake" = "intake") {
  const session = await openSession(
    { gatewayUrl: base, token },
    { agent: agentId, projectId, workerId: `${agentId}-1` },
  );
  sessions.push(session);
  return session;
}

/** A WebSocket subscribed to a project, keeping every message it gets (Node's own client). */
async function subscribe(projectId: string) {
  const ws = new WebSocket(`${base.replace("http", "ws")}/ws?token=ui-t`);
  sockets.push(ws);
  const messages: ServerMessage[] = [];
  ws.addEventListener("message", (m) => messages.push(JSON.parse(String(m.data)) as ServerMessage));
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  ws.send(JSON.stringify({ type: "subscribe", projectId }));
  await new Promise((r) => setTimeout(r, 200)); // the subscription is set after a registry read
  return messages;
}

/** Waits up to 5 s for a message that passes `ok`. */
async function waitFor(messages: ServerMessage[], ok: (m: ServerMessage) => boolean) {
  for (let end = Date.now() + 5000; !messages.some(ok) && Date.now() < end;) {
    await new Promise((r) => setTimeout(r, 20));
  }
  expect(messages.some(ok)).toBe(true);
}

/** Opens an intake item in the project and claims it over MCP: one real write, with its events. */
async function claimOne(t: Tenant) {
  const item = (await openItem(t.ctx, {
    kind: "intake",
    subjectId: null,
    createdBy: "human:test",
    now: Date.now(),
  }))!;
  const intake = await mcp(t.ctx.projectId, "agent-t");
  await intake.call("claim_item", { itemId: item.id });
}

const projectOf = (m: ServerMessage) => (m.type === "event" ? m.event.projectId : m.type);

/** Each row is [id, projectId]: the ones that are not this project's are foreign. */
const foreign = (rows: unknown[][], self: Tenant, other: Tenant) =>
  rows.filter((r) => r[1] !== self.ctx.projectId || other.ids.includes(r[0] as string));

describe("Done when: 0 foreign nodes; the unknown id fails", () => {
  let a: Tenant;
  let b: Tenant;
  beforeAll(async () => {
    a = await tenant("Lotus");
    b = await tenant("Palm");
  });

  it("gives each client its own graph", () => {
    expect(a.ctx.graph).not.toBe(b.ctx.graph);
    expect(a.ids.length).toBeGreaterThan(0);
    expect(b.ids.length).toBeGreaterThan(0);
    expect(a.ids.filter((id) => b.ids.includes(id))).toEqual([]);
  });

  it("route 23 and the read_query tool from each project return only that project's nodes", async () => {
    for (const [self, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const rest = await query(self.ctx.projectId, ALL);
      expect(rest.rows.length).toBe(self.ids.length);
      expect(foreign(rest.rows, self, other)).toEqual([]);

      const session = await mcp(self.ctx.projectId, "ui-t");
      const tool = await session.call("read_query", { graph: "client", cypher: ALL });
      expect(tool.rows.length).toBe(self.ids.length);
      expect(foreign(tool.rows, self, other)).toEqual([]);

      // Asked by id (params are scalars, so one id at a time), the other client's nodes are not
      // there.
      for (const id of other.ids) {
        const named = await query(self.ctx.projectId, BY_ID, { id });
        expect(named.status).toBe(200);
        expect(named.rows).toEqual([]);
      }
    }
  });

  it("route 6 does not find the other client's node from this project", async () => {
    const res = await fetch(`${base}/api/projects/${a.ctx.projectId}/nodes/${b.ids[0]}`, {
      headers: ui,
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });

  it("sends a write's live event only to its own project's subscribers", async () => {
    const onA = await subscribe(a.ctx.projectId);
    const onB = await subscribe(b.ctx.projectId);
    await claimOne(b);
    await waitFor(onB, (m) => projectOf(m) === b.ctx.projectId);
    await new Promise((r) => setTimeout(r, 200)); // time for a stray event to arrive
    expect(onA).toEqual([]);
    // A's subscription was live all along: its own write reaches it, and B's subscriber never.
    await claimOne(a);
    await waitFor(onA, (m) => projectOf(m) === a.ctx.projectId);
    expect(onA.map(projectOf).filter((p) => p !== a.ctx.projectId)).toEqual([]);
    expect(onB.map(projectOf).filter((p) => p !== b.ctx.projectId)).toEqual([]);
  });

  it("fails an unknown project id on every path", async () => {
    const unknown = UNKNOWN;
    await expect(graphFor(db, unknown)).rejects.toBeInstanceOf(UnknownProjectError);
    // An MCP session bound to it is refused.
    await expect(mcp(unknown, "agent-t")).rejects.toThrow(`Unknown project ${unknown}.`);
    await expect(mcp(unknown, "ui-t")).rejects.toThrow(`Unknown project ${unknown}.`);
    // A REST route on it is NOT_FOUND.
    const board = await fetch(`${base}/api/projects/${unknown}/board`, { headers: ui });
    expect(board.status).toBe(404);
    expect(((await board.json()) as { error: { code: string } }).error.code).toBe("NOT_FOUND");
    // Route 23 refuses it at the tenancy guard.
    const refused = await query(unknown, ALL_IDS);
    expect(refused.error).toMatchObject({
      code: "GUARD_REJECTED",
      details: { reasonCode: "PROJECT_UNKNOWN" },
    });
    // A live subscription to it gets an error.
    const live = await subscribe(unknown);
    await waitFor(live, (m) => m.type === "error");
    expect(live).toEqual([
      { type: "error", error: { code: "NOT_FOUND", reason: `Unknown project ${unknown}.` } },
    ]);
  });
});
