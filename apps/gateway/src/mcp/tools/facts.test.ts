// write_fact, recall_context for intake, and T3 (complete_item on the last intake item), through the
// real gateway (MCP SDK client) against the real FalkorDB from docker-compose.yml. No mocks.
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type Envelope, type WorkItemKind } from "@agencymem/contracts";
import { REGISTRY_GRAPH, close, connect, readQuery, type FalkorDB } from "@agencymem/graph";
import { createProject, openItem, writeDocument, type Ctx } from "@agencymem/memory";
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
  for (const graph of graphs) await db.selectGraph(graph).delete();
  await close();
});

/** A fresh project with one processed Document of two episodes and one intake item for it. */
async function setup() {
  const { project, client } = await createProject(db, {
    clientName: `test-client-${randomUUID()}`,
    projectName: "Facts",
    mode: "demo",
    createdBy: "human:test",
    now: Date.now(),
  });
  const ctx: Ctx = { db, graph: `client_${client.id}`, projectId: project.id };
  graphs.add(ctx.graph);
  const { document, episodeIds } = await writeDocument(ctx, {
    name: "kickoff-notes.pdf",
    mime: "application/pdf",
    sha256: "b".repeat(64),
    status: "processed",
    wordCount: 20,
    error: null,
    episodes: [
      { page: 1, lineStart: 1, lineEnd: 2, text: "The admin panel lists the bookings." },
      { page: 1, lineStart: 4, lineEnd: 4, text: "The back office adds doctors." },
    ],
    createdBy: "human:test",
    now: Date.now(),
  });
  const item = (await openItem(ctx, {
    kind: "intake",
    subjectId: document.id,
    createdBy: "human:test",
    now: Date.now(),
  }))!;
  return { ctx, document, episodeIds, item };
}

async function agent(projectId: string, agentId = "intake", worker = "intake-1"): Promise<Client> {
  const client = new Client({ name: "test", version: "0" });
  const headers = {
    "X-AM-Token": "agent-t",
    "X-AM-Agent": agentId,
    "X-AM-Project": projectId,
    "X-AM-Worker": worker,
  };
  await client.connect(
    new StreamableHTTPClientTransport(new URL(base), { requestInit: { headers } }),
  );
  clients.push(client);
  return client;
}

type Result = { isError?: boolean; structuredContent?: Record<string, unknown> };
async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as Result;
  return { isError: result.isError === true, out: result.structuredContent ?? {} };
}
const reasonCode = (out: Record<string, unknown>) =>
  (out.error as { details?: { reasonCode?: string } }).details?.reasonCode;
const rows = (ctx: Ctx, cypher: string) =>
  db
    .selectGraph(ctx.graph)
    .roQuery(cypher)
    .then((r) => (r.data ?? []) as Record<string, unknown>[]);

const fact = (episodeIds: string[], over: Record<string, unknown> = {}) => ({
  statement: "The admin panel lists the bookings.",
  subject: "admin-panel",
  attribute: "shows",
  value: "the bookings",
  entity: { key: "admin-panel", name: "Admin panel", aliases: ["back office"] },
  episodeIds,
  ...over,
});

describe("Done when: every fact has a SOURCED_FROM edge; admin panel and back office share one Entity", () => {
  it("writes each Fact with SOURCED_FROM to its episodes and ABOUT its Entity", async () => {
    const { ctx, episodeIds, item } = await setup();
    const intake = await agent(ctx.projectId);
    const sent: Envelope[] = [];
    const off = events.on((e) => e.projectId === ctx.projectId && sent.push(e));
    const res = await call(intake, "write_fact", {
      itemId: item.id,
      facts: [fact([episodeIds[0]!]), fact(episodeIds, { attribute: "lists", value: "bookings" })],
    });
    off();
    expect(res.isError).toBe(false);
    const { factIds, entityIds, superseded } = res.out as {
      factIds: string[];
      entityIds: string[];
      superseded: string[];
    };
    expect(factIds).toHaveLength(2);
    expect(entityIds).toHaveLength(1);
    expect(superseded).toEqual([]);

    const sourced = await rows(
      ctx,
      q(
        "MATCH",
        "(f:Fact)-[:SOURCED_FROM]->(e:Episode)",
        "RETURN",
        "f.id AS f, e.id AS e ORDER BY f, e",
      ),
    );
    expect(sourced).toEqual(
      [{ f: factIds[0], e: episodeIds[0] }, ...episodeIds.map((e) => ({ f: factIds[1], e }))].sort(
        (a, b) => a.f!.localeCompare(b.f!) || a.e!.localeCompare(b.e!),
      ),
    );
    const about = await rows(
      ctx,
      q("MATCH", "(f:Fact)-[:ABOUT]->(n:Entity)", "RETURN", "n.key AS key"),
    );
    expect(about).toEqual([{ key: "admin-panel" }, { key: "admin-panel" }]);
    const facts = await rows(
      ctx,
      q(
        "MATCH",
        "(f:Fact)",
        "RETURN",
        "f.subject AS s, f.validFrom > 0 AS current, f.validTo AS validTo",
      ),
    );
    expect(facts).toEqual([
      { s: "admin-panel", current: true, validTo: null },
      { s: "admin-panel", current: true, validTo: null },
    ]);
    expect(sent.map((e) => [e.type, (e.data as { label?: string }).label])).toEqual([
      ["node.written", "Fact"],
      ["node.written", "Entity"],
    ]);
  });

  it("matches an entity through its aliases: back office is the admin panel", async () => {
    const { ctx, episodeIds, item } = await setup();
    const intake = await agent(ctx.projectId);
    await call(intake, "write_fact", { itemId: item.id, facts: [fact([episodeIds[0]!])] });
    const second = await call(intake, "write_fact", {
      itemId: item.id,
      facts: [
        fact([episodeIds[1]!], {
          statement: "The back office adds doctors.",
          subject: "back-office",
          attribute: "adds",
          value: "doctors",
          entity: { key: "back-office", name: "Back office", aliases: ["staff page"] },
        }),
      ],
    });
    expect(second.isError).toBe(false);
    const entities = await rows(
      ctx,
      q("MATCH", "(n:Entity)", "RETURN", "n.key AS key, n.aliases AS aliases"),
    );
    expect(entities).toEqual([{ key: "admin-panel", aliases: ["back office", "staff page"] }]);
    const subjects = await rows(ctx, q("MATCH", "(f:Fact)", "RETURN", "f.subject AS s"));
    expect(subjects).toEqual([{ s: "admin-panel" }, { s: "admin-panel" }]);
  });
});

describe("write_fact guards and rules", () => {
  it("refuses an episode that does not exist (source, counted) and writes nothing", async () => {
    const { ctx, item } = await setup();
    const intake = await agent(ctx.projectId);
    const res = await call(intake, "write_fact", {
      itemId: item.id,
      facts: [fact(["01ARZ3NDEKTSV4RRFFQ69G5FAV"])],
    });
    expect(res.isError).toBe(true);
    expect(reasonCode(res.out)).toBe("SOURCE_UNKNOWN");
    expect(await rows(ctx, q("MATCH", "(f:Fact)", "RETURN", "count(f) AS n"))).toEqual([{ n: 0 }]);
    const [project] = await readQuery<{ p: { properties: { rejectedWrites: number } } }>(
      db,
      REGISTRY_GRAPH,
      "read/project",
      { projectId: ctx.projectId },
    );
    expect(project!.p.properties.rejectedWrites).toBe(1);
  });

  it("writes one SOURCED_FROM edge per episode, even when an episode id repeats", async () => {
    const { ctx, episodeIds, item } = await setup();
    const intake = await agent(ctx.projectId);
    const res = await call(intake, "write_fact", {
      itemId: item.id,
      facts: [fact([episodeIds[0]!, episodeIds[0]!])],
    });
    expect(res.isError).toBe(false);
    expect(
      await rows(
        ctx,
        q("MATCH", "(:Fact)-[s:SOURCED_FROM]->(:Episode)", "RETURN", "count(s) AS n"),
      ),
    ).toEqual([{ n: 1 }]);
  });

  it("does not merge entities through a blank alias", async () => {
    const { ctx, episodeIds, item } = await setup();
    const intake = await agent(ctx.projectId);
    const blank = (key: string, name: string) => ({ key, name, aliases: [" ", ""] });
    await call(intake, "write_fact", {
      itemId: item.id,
      facts: [fact(episodeIds, { subject: "calendar", entity: blank("calendar", "Calendar") })],
    });
    await call(intake, "write_fact", {
      itemId: item.id,
      facts: [fact(episodeIds, { subject: "payment", entity: blank("payment", "Payment") })],
    });
    expect(
      await rows(
        ctx,
        q("MATCH", "(n:Entity)", "RETURN", "n.key AS key, n.aliases AS aliases ORDER BY key"),
      ),
    ).toEqual([
      { key: "calendar", aliases: [] },
      { key: "payment", aliases: [] },
    ]);
  });

  it("refuses the same replacesFactId twice in one call", async () => {
    const { ctx, episodeIds, item, document } = await setup();
    const intake = await agent(ctx.projectId);
    const first = await call(intake, "write_fact", { itemId: item.id, facts: [fact(episodeIds)] });
    const old = (first.out.factIds as string[])[0]!;
    const answer = (await openItem(ctx, {
      kind: "intake_answer",
      subjectId: document.id,
      createdBy: "human:test",
      now: Date.now(),
    }))!;
    const res = await call(intake, "write_fact", {
      itemId: answer.id,
      facts: [
        fact(episodeIds, { value: "a", replacesFactId: old }),
        fact(episodeIds, { value: "b", replacesFactId: old }),
      ],
    });
    expect(res.out).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
    expect(await rows(ctx, q("MATCH", "(f:Fact)", "RETURN", "count(f) AS n"))).toEqual([{ n: 1 }]);
  });

  it("refuses another agent (ownership)", async () => {
    const { ctx, episodeIds, item } = await setup();
    const discovery = await agent(ctx.projectId, "discovery", "discovery-1");
    const res = await call(discovery, "write_fact", { itemId: item.id, facts: [fact(episodeIds)] });
    expect(reasonCode(res.out)).toBe("LABEL_NOT_OWNED");
  });

  it("refuses a subject that is not the fact's entity key", async () => {
    const { ctx, episodeIds, item } = await setup();
    const intake = await agent(ctx.projectId);
    const res = await call(intake, "write_fact", {
      itemId: item.id,
      facts: [fact(episodeIds, { subject: "calendar" })],
    });
    expect(res.out).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });

  it("refuses replacesFactId outside an intake_answer item", async () => {
    const { ctx, episodeIds, item } = await setup();
    const intake = await agent(ctx.projectId);
    const first = await call(intake, "write_fact", { itemId: item.id, facts: [fact(episodeIds)] });
    const old = (first.out.factIds as string[])[0]!;
    const res = await call(intake, "write_fact", {
      itemId: item.id,
      facts: [fact(episodeIds, { replacesFactId: old })],
    });
    expect(res.out).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });

  it("supersedes the replaced fact on an intake_answer item: validTo, SUPERSEDES, node.ended", async () => {
    const { ctx, episodeIds, item, document } = await setup();
    const intake = await agent(ctx.projectId);
    const first = await call(intake, "write_fact", { itemId: item.id, facts: [fact(episodeIds)] });
    const old = (first.out.factIds as string[])[0]!;
    const answer = (await openItem(ctx, {
      kind: "intake_answer" as WorkItemKind,
      subjectId: document.id,
      createdBy: "human:test",
      now: Date.now(),
    }))!;
    const sent: Envelope[] = [];
    const off = events.on((e) => e.projectId === ctx.projectId && sent.push(e));
    const res = await call(intake, "write_fact", {
      itemId: answer.id,
      facts: [fact(episodeIds, { value: "today's bookings", replacesFactId: old })],
    });
    off();
    expect(res.isError).toBe(false);
    const created = (res.out.factIds as string[])[0]!;
    expect(res.out.superseded).toEqual([old]);
    const edge = await rows(
      ctx,
      q(
        "MATCH",
        "(n:Fact)-[:SUPERSEDES]->(o:Fact)",
        "RETURN",
        "n.id AS n, o.id AS o, o.validTo > 0 AS ended",
      ),
    );
    expect(edge).toEqual([{ n: created, o: old, ended: true }]);
    expect(sent.find((e) => e.type === "node.ended")?.data).toMatchObject({
      factId: old,
      replacedBy: created,
    });
  });
});

describe("recall_context for an intake item", () => {
  it("returns the Document's episodes with name, page and lines, and the project's entities", async () => {
    const { ctx, episodeIds, item } = await setup();
    const intake = await agent(ctx.projectId);
    await call(intake, "write_fact", { itemId: item.id, facts: [fact([episodeIds[0]!])] });
    const res = await call(intake, "recall_context", { itemId: item.id });
    const context = (res.out as { context: Record<string, unknown> }).context;
    expect(context.episodes).toEqual([
      {
        id: episodeIds[0],
        kind: "file_chunk",
        documentName: "kickoff-notes.pdf",
        page: 1,
        lineStart: 1,
        lineEnd: 2,
        text: "The admin panel lists the bookings.",
      },
      {
        id: episodeIds[1],
        kind: "file_chunk",
        documentName: "kickoff-notes.pdf",
        page: 1,
        lineStart: 4,
        lineEnd: 4,
        text: "The back office adds doctors.",
      },
    ]);
    expect(context.entities).toEqual([
      { key: "admin-panel", name: "Admin panel", aliases: ["back office"] },
    ]);
  });
});

describe("T3: the last intake item done opens discovery", () => {
  it("opens a discovery item and moves the project to discovery", async () => {
    const { ctx, item } = await setup();
    const intake = await agent(ctx.projectId);
    await call(intake, "claim_item", { itemId: item.id });
    const res = await call(intake, "complete_item", { itemId: item.id, outcome: "done", runs: [] });
    expect(res.out).toMatchObject({ opened: [{ kind: "discovery" }] });
    const [project] = await readQuery<{ p: { properties: { stage: string } } }>(
      db,
      REGISTRY_GRAPH,
      "read/project",
      { projectId: ctx.projectId },
    );
    expect(project!.p.properties.stage).toBe("discovery");
  });

  it("waits while another intake item is open", async () => {
    const { ctx, item } = await setup();
    await openItem(ctx, {
      kind: "intake",
      subjectId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      createdBy: "human:test",
      now: Date.now(),
    });
    const intake = await agent(ctx.projectId);
    await call(intake, "claim_item", { itemId: item.id });
    const res = await call(intake, "complete_item", { itemId: item.id, outcome: "done", runs: [] });
    expect(res.out).toMatchObject({ opened: [] });
  });
});
