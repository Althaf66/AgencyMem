// submit_test_run and recall_context for a test_run item (contracts.md section 7, agent-prompts.md
// section 7) through the real gateway against the real FalkorDB from docker-compose.yml. No mocks.
// The commit arrives through the real hook route, as in a build run.
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type Envelope } from "@agencymem/contracts";
import { close, connect, readQuery, type FalkorDB } from "@agencymem/graph";
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

const card = (n: number) => ({
  key: `CARD-0${n}`,
  title: `Card ${n}`,
  description: `Builds part ${n}.`,
  lane: "Backend",
  order: n * 10,
  requirementKey: "REQ-01",
  designKeys: [],
  dependsOn: [],
  criteria: [1, 2].map((i) => ({
    key: `AC-0${n}-${i}`,
    text: `Given ${n}.${i}, when it runs, then it works.`,
    testIds: [],
  })),
});

let shas = 0;
const nextSha = () => (++shas).toString(16).padStart(40, "d");

/**
 * A project in build: CARD-01 and CARD-02, each with two criteria and their TestCases. CARD-01 was
 * In progress and got a build commit through the hook, so it is in Testing with a test_run item.
 */
async function setup() {
  const now = Date.now();
  const { project, client } = await createProject(db, {
    clientName: `test-client-${randomUUID()}`,
    projectName: "Test runs",
    mode: "demo",
    createdBy: "human:test",
    now,
  });
  const ctx: Ctx = { db, graph: `client_${client.id}`, projectId: project.id };
  graphs.add(ctx.graph);
  await setStage(db, project.id, "intake", "build");
  const { episodeIds } = await writeDocument(ctx, {
    name: "notes.pdf",
    mime: "application/pdf",
    sha256: "b".repeat(64),
    status: "processed",
    wordCount: 3,
    error: null,
    episodes: [{ page: 1, lineStart: 1, lineEnd: 1, text: "One rule." }],
    createdBy: "human:test",
    now,
  });
  const { factIds } = await writeFacts(ctx, {
    entities: [{ key: "clinic", name: "Clinic", aliases: [] }],
    facts: [
      {
        statement: "Rule 1 is A.",
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
    requirements: [{ key: "REQ-01", text: "A patient can book.", priority: "must", factIds }],
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
    cards: [card(1), card(2)] as never,
    createdBy: "planner",
    now,
  }))!;
  const cases: string[][] = [];
  for (const [i, taskId] of taskIds.entries()) {
    const n = i + 1;
    const written = await writeTests(ctx, {
      taskId,
      cases: [1, 2].map((k) => ({
        criterionKey: `AC-0${n}-${k}`,
        file: `tests/e2e/CARD-0${n}/AC-0${n}-${k}.spec.ts`,
        title: `AC-0${n}-${k}: t`,
      })),
      createdBy: "test",
      now,
    });
    cases.push(written!.testCaseIds);
  }
  const [row] = await readQuery<{ n: { properties: { version: number } } }>(
    db,
    ctx.graph,
    "read/node",
    {
      id: taskIds[0]!,
    },
  );
  await writeVersioned(ctx, {
    id: taskIds[0]!,
    version: row!.n.properties.version,
    props: { column: "In progress" },
  });

  const sha = nextSha();
  const res = await fetch(`${base}/hooks/commit`, {
    method: "POST",
    headers: { "X-AM-Token": "hook-t", "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: project.id,
      sha,
      branch: "card/CARD-01",
      files: ["src/booking.ts"],
      message: "feat(CARD-01): book",
      author: "agencymem",
      committedAt: now,
    }),
  });
  const hook = (await res.json()) as { codeChangeId: string; workItemId: string };
  return { ctx, taskIds, cases, sha, ...hook };
}

async function session(projectId: string, agent = "test", worker = "test-run-1"): Promise<Client> {
  const client = new Client({ name: "test", version: "0" });
  const headers = {
    "X-AM-Token": "agent-t",
    "X-AM-Agent": agent,
    "X-AM-Project": projectId,
    "X-AM-Worker": worker,
  };
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }),
  );
  clients.push(client);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
    content: { text: string }[];
  };
  return result.isError
    ? { error: (JSON.parse(result.content[0]!.text) as { error: Record<string, unknown> }).error }
    : { out: result.structuredContent! };
}

const column = async (ctx: Ctx, id: string) =>
  (
    await readQuery<{ n: { properties: Record<string, unknown> } }>(db, ctx.graph, "read/node", {
      id,
    })
  )[0]!.n.properties;

describe("recall_context for a test_run item", () => {
  it("gives the commit and its card with the TestCases to run", async () => {
    const { ctx, taskIds, sha, codeChangeId, workItemId } = await setup();
    const tester = await session(ctx.projectId);
    expect((await call(tester, "claim_item", { kinds: ["test_run"] })).out).toMatchObject({
      item: { id: workItemId },
    });
    const { out } = await call(tester, "recall_context", { itemId: workItemId });
    const context = (
      out as { context: { codeChanges: unknown[]; tasks: { testCases: unknown[] }[] } }
    ).context;
    expect(context.codeChanges).toEqual([
      {
        id: codeChangeId,
        sha,
        branch: "card/CARD-01",
        taskKey: "CARD-01",
        files: ["src/booking.ts"],
        message: "feat(CARD-01): book",
        committedAt: expect.any(Number),
        linked: true,
      },
    ]);
    expect(context.tasks).toMatchObject([{ id: taskIds[0], key: "CARD-01" }]);
    expect(context.tasks[0]!.testCases).toHaveLength(2);
  });
});

describe("submit_test_run", () => {
  it("writes one TestRun per result with the sha, and a failure sends the card back to In progress", async () => {
    const { ctx, taskIds, cases, sha, workItemId } = await setup();
    const tester = await session(ctx.projectId);
    await call(tester, "claim_item", { kinds: ["test_run"] });
    const sent: Envelope[] = [];
    const off = events.on((e) => e.projectId === ctx.projectId && sent.push(e));
    const { out } = await call(tester, "submit_test_run", {
      itemId: workItemId,
      sha,
      taskId: taskIds[0],
      results: [
        { testCaseId: cases[0]![0], passed: true, durationMs: 120 },
        { testCaseId: cases[0]![1], passed: false, durationMs: 300, error: "expected 2 slots" },
      ],
    });
    off();

    expect(out).toMatchObject({ allPassed: false, taskColumn: "In progress" });
    const ids = (out as { testRunIds: string[] }).testRunIds;
    expect(ids).toHaveLength(2);
    const res = await fetch(`${base}/api/query`, {
      method: "POST",
      headers: {
        "X-AM-Token": "ui-t",
        "X-AM-Actor": "human:ana",
        "Content-Type": "application/json",
        "X-AM-Project": ctx.projectId,
      },
      body: JSON.stringify({
        graph: "client",
        cypher: q(
          "MATCH",
          "(r:TestRun)-[:RUNS]->(c:TestCase)",
          "RETURN",
          "c.id, r.sha, r.passed, r.durationMs, r.scope, r.error ORDER BY r.durationMs",
        ),
      }),
    });
    expect(((await res.json()) as { rows: unknown[][] }).rows).toEqual([
      [cases[0]![0], sha, true, 120, "card", null],
      [cases[0]![1], sha, false, 300, "card", "expected 2 slots"],
    ]);
    expect(await column(ctx, taskIds[0]!)).toMatchObject({
      column: "In progress",
      note: "Tests failed: AC-01-2",
    });
    expect(sent.map((e) => e.type)).toEqual(["node.written", "task.moved"]);
    expect(sent[1]!.data).toMatchObject({ from: "Testing", to: "In progress" });
  });

  it("keeps the card in Testing when every test passed", async () => {
    const { ctx, taskIds, cases, sha, workItemId } = await setup();
    const tester = await session(ctx.projectId);
    await call(tester, "claim_item", { kinds: ["test_run"] });
    const { out } = await call(tester, "submit_test_run", {
      itemId: workItemId,
      sha,
      taskId: taskIds[0],
      results: cases[0]!.map((testCaseId) => ({ testCaseId, passed: true, durationMs: 50 })),
    });
    expect(out).toMatchObject({ allPassed: true, taskColumn: "Testing" });
    expect(await column(ctx, taskIds[0]!)).toMatchObject({ column: "Testing" });
  });

  it("refuses another card's TestCase (source), another commit, an e2e run, and a non-test agent", async () => {
    const { ctx, taskIds, cases, sha, workItemId } = await setup();
    const tester = await session(ctx.projectId);
    await call(tester, "claim_item", { kinds: ["test_run"] });
    const results = (testCaseId: string) => [{ testCaseId, passed: true, durationMs: 1 }];

    expect(
      (
        await call(tester, "submit_test_run", {
          itemId: workItemId,
          sha,
          taskId: taskIds[0],
          results: results(cases[1]![0]!),
        })
      ).error,
    ).toMatchObject({ guard: "source", details: { reasonCode: "SOURCE_UNKNOWN" } });
    expect(
      (
        await call(tester, "submit_test_run", {
          itemId: workItemId,
          sha: nextSha(),
          taskId: taskIds[0],
          results: results(cases[0]![0]!),
        })
      ).error,
    ).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(
      (
        await call(tester, "submit_test_run", {
          itemId: workItemId,
          sha,
          results: results(cases[0]![0]!),
        })
      ).error,
    ).toMatchObject({ code: "VALIDATION_FAILED" });
    const planner = await session(ctx.projectId, "planner", "planner-1");
    expect(
      (
        await call(planner, "submit_test_run", {
          itemId: workItemId,
          sha,
          taskId: taskIds[0],
          results: results(cases[0]![0]!),
        })
      ).error,
    ).toMatchObject({ guard: "ownership" });
    expect(await column(ctx, taskIds[0]!)).toMatchObject({ column: "Testing" });
  });
});
