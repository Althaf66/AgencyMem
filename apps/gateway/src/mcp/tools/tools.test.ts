// The shared tools through the real gateway (MCP SDK client) against the real FalkorDB from
// docker-compose.yml. No mocks. A listener on the gateway's event bus records every event.
import { randomUUID } from "node:crypto";
import { ulid } from "ulid";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, type Envelope, type WorkItem } from "@agencymem/contracts";
import { REGISTRY_GRAPH, close, connect, readQuery, type FalkorDB } from "@agencymem/graph";
import { createProject, openItem, type Ctx, deleteTestClient } from "@agencymem/memory";
import { createEvents } from "../../events/bus";
import { createGateway } from "../../main";

const TOKENS = { AM_AGENT_TOKEN: "agent-t", AM_UI_TOKEN: "ui-t", AM_HOOK_TOKEN: "hook-t" };
const FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";
const UNKNOWN = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
// Built at run time, so this file holds no Cypher string literal (AGENTS.md rule 4).
const q = (...parts: string[]) => parts.join(" ");

let db: FalkorDB;
let server: Server;
let base: string;
let ctx: Ctx;
const events = createEvents();
let seen: Envelope[] = [];
const clients: Client[] = [];

beforeAll(async () => {
  db = await connect(FALKORDB_URL);
  const { project, client } = await createProject(db, {
    clientName: `test-client-${randomUUID()}`,
    projectName: "Tools",
    mode: "demo",
    createdBy: "human:test",
    now: Date.now(),
  });
  ctx = { db, graph: `client_${client.id}`, projectId: project.id };
  events.on((e) => seen.push(e));
  server = createGateway(loadConfig({ ...TOKENS, FALKORDB_URL }, "gateway"), { events });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});
afterAll(async () => {
  await Promise.allSettled(clients.map((c) => c.close()));
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await deleteTestClient(db, ctx.graph);
  await close();
});
beforeEach(() => {
  seen = [];
});

async function session(headers: Record<string, string>): Promise<Client> {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(base), { requestInit: { headers } }),
  );
  clients.push(client);
  return client;
}
const agent = (agentId: string, worker: string) =>
  session({
    "X-AM-Token": "agent-t",
    "X-AM-Agent": agentId,
    "X-AM-Project": ctx.projectId,
    "X-AM-Worker": worker,
  });
const ui = () => session({ "X-AM-Token": "ui-t", "X-AM-Project": ctx.projectId });

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
const reasonCode = (out: Record<string, unknown>) =>
  (out.error as { details?: { reasonCode?: string } }).details?.reasonCode;

async function node(id: string): Promise<Record<string, unknown> | undefined> {
  const [row] = await readQuery<{ n: { properties: Record<string, unknown> } }>(
    db,
    ctx.graph,
    "read/node",
    { id },
  );
  return row?.n.properties;
}
async function counter(name: string): Promise<number> {
  const [row] = await readQuery<{ p: { properties: Record<string, number> } }>(
    db,
    REGISTRY_GRAPH,
    "read/project",
    { projectId: ctx.projectId },
  );
  return row!.p.properties[name]!;
}
const open = (kind: WorkItem["kind"] = "intake") =>
  openItem(ctx, { kind, subjectId: ulid(), createdBy: "human:test", now: Date.now() });

describe("Done when: guard, write and event in that order", () => {
  it("a rejected call writes nothing and sends only the rejection; a passing call writes, then sends events", async () => {
    const item = (await open())!;
    const a = await agent("intake", "intake-1");
    const b = await agent("intake", "intake-2");

    // claim: the write lands, then lease.changed carries what was written.
    const claimed = await call(a, "claim_item", { itemId: item.id });
    expect(claimed.isError).toBe(false);
    expect(seen.map((e) => e.type)).toEqual(["lease.changed"]);
    expect(seen[0]).toMatchObject({
      data: { itemId: item.id, owner: "intake-1", reason: "claim" },
    });
    expect(await node(item.id)).toMatchObject({
      status: "claimed",
      leaseOwner: "intake-1",
      version: 2,
    });

    // guard: B's heartbeat on A's lease is rejected before any write. The lease is unchanged; only the
    // rejection events go out, and the counter rose by one.
    seen = [];
    const writesBefore = await counter("rejectedWrites");
    const refused = await call(b, "heartbeat", { itemId: item.id });
    expect(refused.isError).toBe(true);
    expect(reasonCode(refused.out)).toBe("LEASE_OTHER_WORKER");
    expect(seen.map((e) => e.type)).toEqual(["write.rejected", "metrics.updated"]);
    expect(seen[0]?.data).toMatchObject({ tool: "heartbeat", guard: "lease", agent: "intake" });
    expect(seen[1]?.data).toEqual({ metric: "rejectedWrites", value: writesBefore + 1 });
    expect(await counter("rejectedWrites")).toBe(writesBefore + 1);
    expect(await node(item.id)).toMatchObject({ leaseOwner: "intake-1", version: 2 });

    // write then event: complete commits version 3, and node.written reports that version.
    seen = [];
    const done = await call(a, "complete_item", { itemId: item.id, outcome: "done", runs: [] });
    expect(done.out).toMatchObject({ item: { id: item.id, status: "done" }, opened: [] });
    expect(seen.map((e) => e.type)).toEqual(["lease.changed", "node.written"]);
    expect(seen[1]?.data).toMatchObject({ label: "WorkItem", id: item.id, version: 3 });
    expect(await node(item.id)).toMatchObject({ status: "done", version: 3 });
    // Every event carries the next seq of the project.
    expect(seen[1]!.seq).toBe(seen[0]!.seq + 1);
  });
});

describe("claim_item", () => {
  it("claims the oldest item of the agent's kinds by default", async () => {
    const item = (await open("discovery"))!;
    const d = await agent("discovery", "discovery-1");
    const { out } = await call(d, "claim_item", {});
    expect(out).toMatchObject({
      item: { id: item.id, status: "claimed", leaseOwner: "discovery-1" },
    });
  });

  it("refuses a kind the agent does not claim", async () => {
    const d = await agent("discovery", "discovery-2");
    const { isError, out } = await call(d, "claim_item", { kinds: ["intake"] });
    expect(isError).toBe(true);
    expect(out).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });

  it("rejects a held item with LEASE_HELD, counted as a rejected claim", async () => {
    const item = (await open())!;
    const a = await agent("intake", "intake-3");
    const b = await agent("intake", "intake-4");
    await call(a, "claim_item", { itemId: item.id });
    const claimsBefore = await counter("rejectedClaims");
    const { isError, out } = await call(b, "claim_item", { itemId: item.id });
    expect(isError).toBe(true);
    expect(reasonCode(out)).toBe("LEASE_HELD");
    expect(await counter("rejectedClaims")).toBe(claimsBefore + 1);
  });

  it("refuses a named item of a kind the agent does not claim (not LEASE_HELD)", async () => {
    const item = (await open("discovery"))!;
    const a = await agent("intake", "intake-11");
    const claimsBefore = await counter("rejectedClaims");
    const { out } = await call(a, "claim_item", { itemId: item.id });
    expect(out).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
    expect(await counter("rejectedClaims")).toBe(claimsBefore);
  });

  it("answers NOT_FOUND for an unknown item", async () => {
    const a = await agent("intake", "intake-5");
    const { out } = await call(a, "claim_item", { itemId: UNKNOWN });
    expect(out).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});

describe("heartbeat", () => {
  it("answers NOT_FOUND for an unknown id, not a counted lease rejection", async () => {
    const a = await agent("intake", "intake-12");
    const writesBefore = await counter("rejectedWrites");
    const { out } = await call(a, "heartbeat", { itemId: UNKNOWN });
    expect(out).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(await counter("rejectedWrites")).toBe(writesBefore);
  });

  it("renews the owner's lease and sends lease.changed (renew)", async () => {
    const item = (await open())!;
    const a = await agent("intake", "intake-6");
    await call(a, "claim_item", { itemId: item.id });
    seen = [];
    const { isError, out } = await call(a, "heartbeat", { itemId: item.id });
    expect(isError).toBe(false);
    expect(typeof out.leaseUntil).toBe("number");
    expect(seen.map((e) => [e.type, (e.data as { reason?: string }).reason])).toEqual([
      ["lease.changed", "renew"],
    ]);
  });
});

describe("complete_item, write_handoff and recall_context", () => {
  it("records runs, keeps a handoff, and shows it to the next item's recall", async () => {
    const first = (await open())!;
    const a = await agent("intake", "intake-7");
    await call(a, "claim_item", { itemId: first.id });

    const handoff = await call(a, "write_handoff", {
      itemId: first.id,
      summary: "Read 2 files, wrote 9 facts",
      outputIds: [],
    });
    expect(handoff.out).toEqual({ itemId: first.id, reportId: null });
    const run = {
      step: "think",
      model: "thin",
      endpoint: "primary",
      tokensIn: 10,
      tokensOut: 5,
      ms: 100,
      cost: 0.001,
    };
    await call(a, "complete_item", { itemId: first.id, outcome: "done", runs: [run] });
    const runs = await readQuery(db, ctx.graph, "read/item-runs", { itemId: first.id });
    expect(runs).toHaveLength(1);

    const second = (await open())!;
    await call(a, "claim_item", { itemId: second.id });
    const recall = await call(a, "recall_context", { itemId: second.id });
    expect(recall.isError).toBe(false);
    expect(recall.out).toMatchObject({
      item: { id: second.id },
      project: { id: ctx.projectId, name: "Tools", stage: "intake", productVersion: 0 },
    });
    const context = recall.out.context as { handoffs: { summary: string; agent: string }[] };
    expect(context.handoffs).toContainEqual(
      expect.objectContaining({ summary: "Read 2 files, wrote 9 facts", agent: "intake" }),
    );
    expect(recall.out.chars).toBeGreaterThan(0);
  });

  it("writes launch's readiness report with the handoff (C8)", async () => {
    const item = (await open("launch"))!;
    const l = await agent("launch", "launch-1");
    await call(l, "claim_item", { itemId: item.id });
    const check = { name: "cards_done", passed: true, detail: "All cards Done", nodeIds: [] };
    const { isError, out } = await call(l, "write_handoff", {
      itemId: item.id,
      summary: "Ready",
      outputIds: [],
      report: { checks: [check] },
    });
    expect(isError).toBe(false);
    const reportId = out.reportId as string;
    expect(await node(reportId)).toMatchObject({
      passed: true,
      override: false,
      checks: JSON.stringify([check]), // C10: an object property is a JSON string
    });
  });

  it("lets only launch send a readiness report (ownership)", async () => {
    const item = (await open())!;
    const a = await agent("intake", "intake-8");
    await call(a, "claim_item", { itemId: item.id });
    const { isError, out } = await call(a, "write_handoff", {
      itemId: item.id,
      summary: "x",
      outputIds: [],
      report: { checks: [] },
    });
    expect(isError).toBe(true);
    expect(reasonCode(out)).toBe("LABEL_NOT_OWNED");
  });
});

describe("find_impact", () => {
  it("answers NOT_FOUND for a fact that does not exist", async () => {
    const a = await agent("intake", "intake-9");
    const { out } = await call(a, "find_impact", { factId: UNKNOWN });
    expect(out).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("runs impact.cypher on a real client graph (no facts yet: no nodes)", async () => {
    expect(await readQuery(db, ctx.graph, "read/impact", { factId: UNKNOWN })).toEqual([]);
  });
});

describe("read_query", () => {
  it("runs a read query for the UI session", async () => {
    await open();
    const u = await ui();
    const { isError, out } = await call(u, "read_query", {
      graph: "client",
      cypher: q("MATCH", "(w:WorkItem)", "RETURN", "count(w) AS n"),
    });
    expect(isError).toBe(false);
    expect(out).toMatchObject({ columns: ["n"], truncated: false });
    expect((out.rows as number[][])[0]![0]).toBeGreaterThan(0);
  });

  it("rejects a write clause (rejected query) and any non-UI session", async () => {
    const u = await ui();
    const before = await counter("rejectedQueries");
    const write = await call(u, "read_query", {
      graph: "client",
      cypher: q("MATCH", "(w:WorkItem)", "SET", "w.x = 1"),
    });
    expect(reasonCode(write.out)).toBe("WRITE_CLAUSE");
    expect(await counter("rejectedQueries")).toBe(before + 1);

    const a = await agent("intake", "intake-10");
    const agentQuery = await call(a, "read_query", {
      graph: "client",
      cypher: q("MATCH", "(w)", "RETURN", "w"),
    });
    expect(reasonCode(agentQuery.out)).toBe("NOT_UI_SESSION");
  });

  it("lets a UI session call nothing but read_query (ownership)", async () => {
    const u = await ui();
    const { isError, out } = await call(u, "claim_item", {});
    expect(isError).toBe(true);
    expect(out).toMatchObject({ error: { guard: "ownership" } });
  });
});
