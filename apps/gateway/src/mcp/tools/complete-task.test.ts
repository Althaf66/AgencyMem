// Task 4.10, Done when: no commit, or a failing run, is rejected with the reason on the card.
// complete_task (contracts.md section 7, C5) with the evidence guard, through the real gateway
// against the real FalkorDB from docker-compose.yml: the card is claimed, its commits come through
// the hook route and its runs through submit_test_run, as in a build. No mocks.
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type Envelope } from "@agencymem/contracts";
import { REGISTRY_GRAPH, close, connect, readQuery, type FalkorDB } from "@agencymem/graph";
import {
  completeTask,
  createProject,
  deleteTestClient,
  openItem,
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

async function session(projectId: string, agent: string, worker: string): Promise<Client> {
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

const card = async (ctx: Ctx, id: string) =>
  (
    await readQuery<{ n: { properties: Record<string, unknown> } }>(db, ctx.graph, "read/node", {
      id,
    })
  )[0]!.n.properties;

async function counters(projectId: string) {
  const [row] = await readQuery<{ p: { properties: Record<string, number> } }>(
    db,
    REGISTRY_GRAPH,
    "read/project",
    {
      projectId,
    },
  );
  return row!.p.properties;
}

let shas = 0;
const nextSha = () => (++shas).toString(16).padStart(40, "e");

/** CARD-01 (two criteria, two TestCases), Ready; build-1 claims it. */
async function claimed() {
  const now = Date.now();
  const { project, client } = await createProject(db, {
    clientName: `test-client-${randomUUID()}`,
    projectName: "Complete",
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
    sha256: "c".repeat(64),
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
    cards: [
      {
        key: "CARD-01",
        title: "Book",
        description: "The booking form.",
        lane: "Backend",
        order: 10,
        requirementKey: "REQ-01",
        designKeys: [],
        dependsOn: [],
        criteria: [1, 2].map((i) => ({
          key: `AC-01-${i}`,
          text: `Given ${i}, then it works.`,
          testIds: [],
        })),
      },
    ] as never,
    createdBy: "planner",
    now,
  }))!;
  const taskId = taskIds[0]!;
  const written = await writeTests(ctx, {
    taskId,
    cases: [1, 2].map((i) => ({
      criterionKey: `AC-01-${i}`,
      file: `tests/e2e/CARD-01/AC-01-${i}.spec.ts`,
      title: `AC-01-${i}: t`,
    })),
    createdBy: "test",
    now,
  });
  const build = await session(project.id, "build", "build-1");
  const { out } = await call(build, "claim_task", { taskId });
  const version = (out as { task: { version: number } }).task.version;
  return { ctx, taskId, testCaseIds: written!.testCaseIds, build, version };
}

/** A build commit through the hook route: the card goes to Testing and a test_run item opens. */
async function commit(ctx: Ctx, author = "agencymem", committedAt = Date.now() + shas) {
  const sha = nextSha();
  const res = await fetch(`${base}/hooks/commit`, {
    method: "POST",
    headers: { "X-AM-Token": "hook-t", "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: ctx.projectId,
      sha,
      branch: "card/CARD-01",
      files: ["src/booking.ts"],
      message: "feat(CARD-01): book",
      author,
      committedAt, // each later than the one before, unless the test gives one
    }),
  });
  return { sha, ...((await res.json()) as { workItemId: string | null }) };
}

/** The Test agent runs the commit's tests: `passed` per TestCase. */
async function runTests(
  ctx: Ctx,
  taskId: string,
  testCaseIds: string[],
  c: { sha: string; workItemId: string | null },
  passed: boolean[],
) {
  const tester = await session(ctx.projectId, "test", "test-run-1");
  await call(tester, "claim_item", { kinds: ["test_run"], itemId: c.workItemId });
  const { out } = await call(tester, "submit_test_run", {
    itemId: c.workItemId,
    sha: c.sha,
    taskId,
    results: testCaseIds.map((testCaseId, i) => ({
      testCaseId,
      passed: passed[i],
      durationMs: 10,
    })),
  });
  await call(tester, "complete_item", { itemId: c.workItemId, outcome: "done", runs: [] });
  return out;
}

describe("Done when: no commit, or a failing run, is rejected with the reason on the card", () => {
  it("rejects a card with no commit (NO_COMMIT), counted, with the reason in its note", async () => {
    const { ctx, taskId, build, version } = await claimed();
    const before = await counters(ctx.projectId);
    const sent: Envelope[] = [];
    const off = events.on((e) => e.projectId === ctx.projectId && sent.push(e));
    const { error } = await call(build, "complete_task", { taskId, version });
    off();
    expect(error).toMatchObject({ guard: "evidence", details: { reasonCode: "NO_COMMIT" } });
    expect(sent.map((e) => e.type)).toEqual(["task.edited", "write.rejected", "metrics.updated"]);
    expect(sent[0]!.data).toMatchObject({ taskId, fields: ["note"], actor: "build" });
    expect(sent[1]!.data).toMatchObject({
      tool: "complete_task",
      guard: "evidence",
      reasonCode: "NO_COMMIT",
    });
    expect((await counters(ctx.projectId)).rejectedCompletions).toBe(
      before.rejectedCompletions! + 1,
    );
    expect(await card(ctx, taskId)).toMatchObject({
      column: "In progress",
      leaseOwner: "build-1",
      note: "Rejected by evidence guard: The card has no recorded commit.",
    });
  });

  it("rejects a failing run on the latest commit (RUN_FAILED) with the failing criteria on the card", async () => {
    const { ctx, taskId, testCaseIds, build, version } = await claimed();
    const c = await commit(ctx);
    await runTests(ctx, taskId, testCaseIds, c, [true, false]);
    const { error } = await call(build, "complete_task", { taskId, version });
    expect(error).toMatchObject({
      guard: "evidence",
      details: { reasonCode: "RUN_FAILED", sha: c.sha, cases: 2, passing: 1, failing: ["AC-01-2"] },
    });
    expect((await card(ctx, taskId)).note).toBe(
      "Rejected by evidence guard: Not every test passes on the latest commit (AC-01-2).",
    );
  });
});

describe("complete_task", () => {
  it("answers RUN_PENDING while the latest commit's tests run, not counted and not on the card", async () => {
    const { ctx, taskId, build, version } = await claimed();
    await commit(ctx);
    const before = await counters(ctx.projectId);
    const { error } = await call(build, "complete_task", { taskId, version });
    expect(error).toMatchObject({ details: { reasonCode: "RUN_PENDING", retryAfterMs: 30000 } });
    expect(await counters(ctx.projectId)).toEqual(before);
    expect((await card(ctx, taskId)).note ?? null).toBeNull();
  });

  it("closes a card whose latest build commit passes every test: Done, lease cleared, a merge item (T19)", async () => {
    const { ctx, taskId, testCaseIds, build, version } = await claimed();
    const failing = await commit(ctx);
    await runTests(ctx, taskId, testCaseIds, failing, [false, false]);
    const fixed = await commit(ctx);
    await runTests(ctx, taskId, testCaseIds, fixed, [true, true]);
    await commit(ctx, "agencymem-test"); // a later spec commit is not a build commit

    const sent: Envelope[] = [];
    const off = events.on((e) => e.projectId === ctx.projectId && sent.push(e));
    // The version is the one from the claim: the run's own commits and tests raised it since, but
    // the caller still holds the lease, so it is not old.
    const { out } = await call(build, "complete_task", { taskId, version });
    off();

    expect(out).toMatchObject({ task: { id: taskId, key: "CARD-01", column: "Done" } });
    expect(await card(ctx, taskId)).toMatchObject({ column: "Done" });
    // The failing run's "Tests failed: ..." explained why the card could not close; it is gone.
    expect((await card(ctx, taskId)).note ?? null).toBeNull();
    expect((await card(ctx, taskId)).leaseOwner ?? null).toBeNull();
    const moved = sent.find((e) => e.type === "task.moved")!;
    expect(moved.data).toMatchObject({ taskId, to: "Done" });
    expect(sent.find((e) => e.type === "lease.changed")!.data).toMatchObject({
      itemId: taskId,
      owner: null,
      reason: "release",
    });
    const merge = sent.find(
      (e) => e.type === "node.written" && (e.data as { label: string }).label === "WorkItem",
    )!;
    expect(await card(ctx, (merge.data as { id: string }).id)).toMatchObject({
      kind: "merge",
      status: "open",
      subjectId: taskId,
    });
  });

  it("orders commits of the same second by when they arrived: the newer one's run is pending", async () => {
    const { ctx, taskId, testCaseIds, build, version } = await claimed();
    const second = Math.floor(Date.now() / 1000) * 1000; // the hook sends whole seconds
    const older = await commit(ctx, "agencymem", second);
    await runTests(ctx, taskId, testCaseIds, older, [true, true]);
    await commit(ctx, "agencymem", second); // same second, recorded later; its test_run is open
    const { error } = await call(build, "complete_task", { taskId, version });
    expect(error).toMatchObject({ details: { reasonCode: "RUN_PENDING" } });
    expect(await card(ctx, taskId)).toMatchObject({ column: "Testing" });
  });

  it("closes nothing when a newer build commit arrived after the check, and opens no second merge item", async () => {
    const { ctx, taskId, testCaseIds } = await claimed();
    const checked = await commit(ctx);
    await runTests(ctx, taskId, testCaseIds, checked, [true, true]);
    const commits = await readQuery<{
      commits: { id: string; sha: string; committedAt: number; createdAt: number }[];
    }>(db, ctx.graph, "read/evidence", { projectId: ctx.projectId, taskId });
    const first = commits[0]!.commits.find((c) => c.sha === checked.sha)!;
    await commit(ctx); // the newer commit, after the check
    const base = {
      taskId,
      workerId: "build-1",
      outcome: "done" as const,
      note: null,
      now: Date.now(),
    };
    expect(await completeTask(ctx, { ...base, latest: first })).toBeNull();
    expect(await card(ctx, taskId)).toMatchObject({ column: "Testing" });

    // With the newest commit checked and a merge item already open, the card closes and no second
    // merge item opens.
    const newest = (
      await readQuery<{
        commits: { id: string; sha: string; committedAt: number; createdAt: number }[];
      }>(db, ctx.graph, "read/evidence", { projectId: ctx.projectId, taskId })
    )[0]!.commits
      .sort((a, b) => a.committedAt - b.committedAt || a.createdAt - b.createdAt)
      .at(-1)!;
    await openItem(ctx, { kind: "merge", subjectId: taskId, createdBy: "build", now: Date.now() });
    const closed = await completeTask(ctx, { ...base, latest: newest });
    expect(closed).toMatchObject({ to: "Done", mergeItemId: null });
  });

  it("rejects an old version with VERSION_OLD once the lease is gone (a human edit), counted", async () => {
    const { ctx, taskId, build, version } = await claimed();
    // The human-wins rule clears the lease and moves the card to Ready with version + 1.
    const now = (await card(ctx, taskId)).version as number;
    await writeVersioned(ctx, {
      id: taskId,
      version: now,
      props: { title: "Book a slot", leaseOwner: null, leaseUntil: null, column: "Ready" },
    });
    const before = await counters(ctx.projectId);
    const { error } = await call(build, "complete_task", { taskId, version });
    expect(error).toMatchObject({ guard: "version", details: { reasonCode: "VERSION_OLD" } });
    expect((await counters(ctx.projectId)).rejectedWrites).toBe(before.rejectedWrites! + 1);
  });

  it("sends a failed run back to Ready with attempts + 1 and the note", async () => {
    const { ctx, taskId, build, version } = await claimed();
    const { out } = await call(build, "complete_task", {
      taskId,
      version,
      outcome: "failed",
      note: "Provider error after the fallback.",
    });
    expect(out).toMatchObject({ task: { column: "Ready" } });
    expect(await card(ctx, taskId)).toMatchObject({
      column: "Ready",
      attempts: 1,
      note: "Provider error after the fallback.",
    });
    expect((await card(ctx, taskId)).leaseOwner ?? null).toBeNull();
  });

  it("refuses a worker that does not hold the lease, and an agent that is not build", async () => {
    const { ctx, taskId, version } = await claimed();
    const other = await session(ctx.projectId, "build", "build-2");
    expect((await call(other, "complete_task", { taskId, version })).error).toMatchObject({
      guard: "lease",
      details: { reasonCode: "LEASE_OTHER_WORKER" },
    });
    const planner = await session(ctx.projectId, "planner", "planner-1");
    expect((await call(planner, "complete_task", { taskId, version })).error).toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});
