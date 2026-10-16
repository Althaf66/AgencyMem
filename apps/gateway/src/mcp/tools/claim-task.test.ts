// Task 4.2, Done when: two workers race for one card, one wins and the rejected-claim count rises
// by 1. claim_task (contracts.md section 7, C1) through the real gateway against the real FalkorDB
// from docker-compose.yml. No mocks.
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type Envelope } from "@agencymem/contracts";
import { REGISTRY_GRAPH, close, connect, readQuery, type FalkorDB } from "@agencymem/graph";
import {
  createProject,
  deleteTestClient,
  setStage,
  writeCards,
  writeDocument,
  writeFacts,
  writeProduct,
  writeTests,
  writeVersioned,
  type Ctx,
} from "@agencymem/memory";
import { createEvents } from "../../events/bus";
import { createGateway } from "../../main";

const TOKENS = { AM_AGENT_TOKEN: "agent-t", AM_UI_TOKEN: "ui-t", AM_HOOK_TOKEN: "hook-t" };
const FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";

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

const card = (n: number, dependsOn: string[] = []) => ({
  key: `CARD-0${n}`,
  title: `Card ${n}`,
  description: `Builds part ${n}.`,
  lane: "Backend",
  order: n * 10,
  requirementKey: "REQ-01",
  designKeys: [],
  dependsOn,
  criteria: [
    { key: `AC-0${n}-1`, text: `Given part ${n}, when it runs, then it works.`, testIds: [] },
  ],
});

/**
 * A project in build with CARD-01..03 on REQ-01, all Ready (each criterion has a TestCase).
 * CARD-02 depends on CARD-01.
 */
async function setup() {
  const now = Date.now();
  const { project, client } = await createProject(db, {
    clientName: `test-client-${randomUUID()}`,
    projectName: "Claims",
    mode: "demo",
    createdBy: "human:test",
    now,
  });
  const ctx: Ctx = { db, graph: `client_${client.id}`, projectId: project.id };
  graphs.add(ctx.graph);
  await setStage(db, project.id, "intake", "build");
  const { episodeIds } = await writeDocument(ctx, {
    name: "kickoff-notes.pdf",
    mime: "application/pdf",
    sha256: "c".repeat(64),
    status: "processed",
    wordCount: 10,
    error: null,
    episodes: [{ page: 1, lineStart: 1, lineEnd: 1, text: "One rule." }],
    createdBy: "human:test",
    now,
  });
  const { factIds } = await writeFacts(ctx, {
    entities: [{ key: "clinic", name: "Clinic", aliases: [] }],
    facts: [
      {
        statement: "Clinic rule 1 is A.",
        subject: "clinic",
        attribute: "rule_1",
        value: "A",
        episodeIds,
        replacesFactId: null,
      },
    ],
    createdBy: "intake",
    now,
  });
  await writeProduct(ctx, {
    baseVersion: 0,
    requirements: [
      { key: "REQ-01", text: "A patient can book.", priority: "must", factIds: [factIds[0]!] },
    ],
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
  const { taskIds } = (await writeCards(ctx, {
    cards: [card(1), card(2, ["CARD-01"]), card(3)] as never,
    createdBy: "planner",
    now,
  }))!;
  for (const [i, taskId] of taskIds.entries()) {
    await writeTests(ctx, {
      taskId,
      cases: [
        { criterionKey: `AC-0${i + 1}-1`, file: `tests/e2e/CARD-0${i + 1}/a.spec.ts`, title: "t" },
      ],
      createdBy: "test",
      now,
    });
  }
  return { ctx, ids: taskIds };
}

/** Sets a card's fields straight in the graph (the state a test starts from). */
async function put(ctx: Ctx, id: string, props: Record<string, string | number | null>) {
  const [row] = await readQuery<{ n: { properties: { version: number } } }>(
    db,
    ctx.graph,
    "read/node",
    { id },
  );
  await writeVersioned(ctx, { id, version: row!.n.properties.version, props });
}

async function rejectedClaims(projectId: string): Promise<number> {
  const [row] = await readQuery<{ p: { properties: { rejectedClaims: number } } }>(
    db,
    REGISTRY_GRAPH,
    "read/project",
    { projectId },
  );
  return row!.p.properties.rejectedClaims;
}

async function worker(projectId: string, workerId: string, agent = "build"): Promise<Client> {
  const client = new Client({ name: "test", version: "0" });
  const headers = {
    "X-AM-Token": "agent-t",
    "X-AM-Agent": agent,
    "X-AM-Project": projectId,
    "X-AM-Worker": workerId,
  };
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }),
  );
  clients.push(client);
  return client;
}

type Claimed = { key: string; column: string; branch: string; version: number } | null;
type Rejected = { code: string; guard?: string; reason: string; details?: Record<string, unknown> };

/** claim_task: the claimed card (or null), or the Rejection of a failed call. */
async function claim(client: Client, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name: "claim_task", arguments: args })) as {
    isError?: boolean;
    structuredContent?: { task: Claimed };
    content: { text: string }[];
  };
  if (result.isError) {
    return { error: (JSON.parse(result.content[0]!.text) as { error: Rejected }).error };
  }
  return { task: result.structuredContent!.task };
}

describe("Done when: two workers race for one card", () => {
  it("one wins, the other gets LEASE_HELD, and rejectedClaims rises by 1", async () => {
    const { ctx, ids } = await setup();
    const [a, b] = await Promise.all([
      worker(ctx.projectId, "build-1"),
      worker(ctx.projectId, "build-2"),
    ]);
    const before = await rejectedClaims(ctx.projectId);
    const sent: Envelope[] = [];
    const off = events.on((e) => e.projectId === ctx.projectId && sent.push(e));

    const results = await Promise.all([claim(a, { taskId: ids[0] }), claim(b, { taskId: ids[0] })]);
    off();

    const won = results.filter((r) => r.task);
    const lost = results.filter((r) => r.error);
    expect(won).toHaveLength(1);
    expect(won[0]!.task).toMatchObject({
      key: "CARD-01",
      column: "In progress",
      branch: "card/CARD-01",
    });
    expect(lost).toHaveLength(1);
    expect(lost[0]!.error).toMatchObject({
      code: "GUARD_REJECTED",
      guard: "lease",
      details: { reasonCode: "LEASE_HELD" },
    });
    expect(await rejectedClaims(ctx.projectId)).toBe(before + 1);
    const rejected = sent.filter((e) => e.type === "write.rejected");
    expect(rejected.map((e) => e.data)).toMatchObject([
      { tool: "claim_task", guard: "lease", reasonCode: "LEASE_HELD", agent: "build" },
    ]);
    const metrics = sent.filter((e) => e.type === "metrics.updated");
    expect(metrics.map((e) => e.data)).toEqual([{ metric: "rejectedClaims", value: before + 1 }]);

    const moves = sent.filter((e) => e.type === "lease.changed" || e.type === "task.moved");
    expect(moves.map((e) => e.type)).toEqual(["lease.changed", "task.moved"]);
    expect(moves[0]!.data).toMatchObject({ itemId: ids[0], reason: "claim" });
    expect(moves[1]!.data).toMatchObject({ taskId: ids[0], from: "Ready", to: "In progress" });
  });
});

describe("claim_task", () => {
  it("takes the lowest-order free card whose dependencies are Done, then answers null", async () => {
    const { ctx } = await setup();
    const w = await worker(ctx.projectId, "build-1");
    const before = await rejectedClaims(ctx.projectId);

    expect((await claim(w)).task).toMatchObject({ key: "CARD-01" });
    // CARD-02 waits for CARD-01, so the next free card is CARD-03.
    expect((await claim(w)).task).toMatchObject({ key: "CARD-03" });
    expect(await claim(w)).toEqual({ task: null });
    expect(await rejectedClaims(ctx.projectId)).toBe(before); // no work is not a rejection
  });

  it("rejects a named card with open dependencies as DEPS_OPEN, counted", async () => {
    const { ctx, ids } = await setup();
    const w = await worker(ctx.projectId, "build-1");
    const before = await rejectedClaims(ctx.projectId);

    const { error } = await claim(w, { taskId: ids[1] });
    expect(error).toMatchObject({
      guard: "deps",
      details: { reasonCode: "DEPS_OPEN", openKeys: ["CARD-01"] },
    });
    expect(await rejectedClaims(ctx.projectId)).toBe(before + 1);

    await put(ctx, ids[0]!, { column: "Done" });
    expect((await claim(w, { taskId: ids[1] })).task).toMatchObject({ key: "CARD-02" });
  });

  it("reclaims a Testing card whose lease ended (C1) and skips a Blocked card", async () => {
    const { ctx, ids } = await setup();
    await put(ctx, ids[0]!, { column: "Testing", leaseOwner: "build-9", leaseUntil: 1 });
    await put(ctx, ids[2]!, { attempts: 2 });
    const w = await worker(ctx.projectId, "build-1");

    expect((await claim(w)).task).toMatchObject({ key: "CARD-01", column: "In progress" });
    expect(await claim(w)).toEqual({ task: null }); // CARD-02 waits, CARD-03 is Blocked
    expect((await claim(w, { taskId: ids[2] })).error).toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  it("refuses a card that is not claimable, and an agent that is not build, without counting", async () => {
    const { ctx, ids } = await setup();
    await put(ctx, ids[2]!, { column: "Backlog" });
    const before = await rejectedClaims(ctx.projectId);

    const w = await worker(ctx.projectId, "build-1");
    expect((await claim(w, { taskId: ids[2] })).error).toMatchObject({
      code: "VALIDATION_FAILED",
    });
    const planner = await worker(ctx.projectId, "planner-1", "planner");
    expect((await claim(planner)).error).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await rejectedClaims(ctx.projectId)).toBe(before);
  });
});
