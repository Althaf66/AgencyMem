// Task 4.13, Done when: two cards build at the same time with no lost writes. Two build workers
// (runLoop with buildWorker) against the real gateway and FalkorDB, on a real project repository
// with the real post-commit hook. A fake OpenCode (opencode.fake.mjs, FAKE_OC=commit) commits in
// the card's worktree; a stand-in Test agent passes each test_run. It lives outside apps/, because
// the runner may not import the gateway (AGENTS.md rule 1).
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "@agencymem/contracts";
import { REGISTRY_GRAPH, close, connect, readQuery, type FalkorDB } from "@agencymem/graph";
import type { ModelClient } from "@agencymem/llm";
import {
  createProject,
  deleteTestClient,
  setStage,
  writeCards,
  writeDocument,
  writeFacts,
  writeProduct,
  writeTests,
  type Ctx,
} from "@agencymem/memory";
import { createGateway } from "../../apps/gateway/src/main";
import { buildWorker } from "../../apps/runner/src/build";
import { runLoop } from "../../apps/runner/src/loop";
import { openSession } from "../../apps/runner/src/mcp-client";
import { ensureRepo } from "../../apps/runner/src/repo";

const run = promisify(execFile);
const TOKENS = { AM_AGENT_TOKEN: "agent-t", AM_UI_TOKEN: "ui-t", AM_HOOK_TOKEN: "hook-t" };
const FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";
const FAKE = [
  process.execPath,
  fileURLToPath(new URL("../../apps/runner/src/opencode.fake.mjs", import.meta.url)),
];

let db: FalkorDB;
let server: Server;
let base: string;
const graphs = new Set<string>();
const workspaces = mkdtempSync(join(tmpdir(), "am-ws-"));

beforeAll(async () => {
  db = await connect(FALKORDB_URL);
  server = createGateway(loadConfig({ ...TOKENS, FALKORDB_URL }, "gateway"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  delete process.env.FAKE_OC;
  delete process.env.FAKE_OC_LOG;
  rmSync(workspaces, { recursive: true, force: true });
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  for (const graph of graphs) await deleteTestClient(db, graph);
  await close();
});

const node = async (ctx: Ctx, id: string) =>
  (
    await readQuery<{ n: { properties: Record<string, unknown> } }>(db, ctx.graph, "read/node", {
      id,
    })
  )[0]!.n.properties;

/** `keys.length` Ready cards with one TestCase each, their branches made, in a project in build. */
async function readyCards(keys: string[]) {
  const now = Date.now();
  const { project, client } = await createProject(db, {
    clientName: `test-client-${randomUUID()}`,
    projectName: "Build workers",
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
    sha256: "7".repeat(64),
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
    cards: keys.map((key, i) => ({
      key,
      title: `Card ${i + 1}`,
      description: "A card.",
      lane: "Backend",
      order: (i + 1) * 10,
      requirementKey: "REQ-01",
      designKeys: [],
      dependsOn: [],
      criteria: [{ key: `AC-0${i + 1}-1`, text: "Given 1, then it works.", testIds: [] }],
    })) as never,
    createdBy: "planner",
    now,
  }))!;
  for (const [i, taskId] of taskIds.entries()) {
    await writeTests(ctx, {
      taskId,
      cases: [
        {
          criterionKey: `AC-0${i + 1}-1`,
          file: `tests/e2e/${keys[i]}/AC-0${i + 1}-1.spec.ts`,
          title: `AC-0${i + 1}-1: t`,
        },
      ],
      createdBy: "test",
      now,
    });
  }
  const repo = await ensureRepo(ctx.projectId, { workspacesDir: workspaces, install: false });
  for (const key of keys) await run("git", ["branch", `card/${key}`, "main"], { cwd: repo });
  return { ctx, taskIds };
}

/** The Test agent's part, faked: every test_run passes. Runs until `stop` aborts. */
async function passEveryRun(projectId: string, stop: AbortSignal) {
  const session = await openSession(
    { gatewayUrl: base, token: "agent-t" },
    { agent: "test", projectId, workerId: "test-run-1" },
  );
  try {
    while (!stop.aborted) {
      const { item } = await session.call("claim_item", { kinds: ["test_run"] });
      if (!item) {
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }
      const { context } = await session.call("recall_context", { itemId: item.id });
      const card = context.tasks![0]!;
      await session.call("submit_test_run", {
        itemId: item.id,
        sha: context.codeChanges![0]!.sha,
        taskId: card.id,
        results: card.testCases.map((c) => ({ testCaseId: c.id, passed: true, durationMs: 5 })),
      });
      await session.call("complete_item", { itemId: item.id, outcome: "done", runs: [] });
    }
  } finally {
    await session.close();
  }
}

/** Runs `workers` build loops on the project until `done()` holds (or 60 s pass). */
async function build(ctx: Ctx, workers: number, done: () => Promise<boolean>) {
  const stop = new AbortController();
  const deps = {
    gatewayUrl: base,
    token: "agent-t",
    llm: {} as ModelClient,
    heartbeatMs: 60_000,
    idleMs: 100,
    projects: async () => [ctx.projectId],
    signal: stop.signal,
  };
  const opts = {
    bin: FAKE,
    workspacesDir: workspaces,
    gatewayUrl: base,
    hookToken: "hook-t",
    fallbackModel: "vendor/model",
    heartbeatMs: 60_000,
    install: false,
    pendingMs: 200,
  };
  const loops = [
    ...Array.from({ length: workers }, (_, i) => runLoop(buildWorker({ ...opts, n: i + 1 }), deps)),
    passEveryRun(ctx.projectId, stop.signal),
  ];
  const deadline = Date.now() + 60_000;
  while (!(await done()) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
  stop.abort();
  await Promise.all(loops);
}

// Built at run time, so this file holds no Cypher string literal (AGENTS.md rule 4).
const q = (...parts: string[]) => parts.join(" ");

/** Route 27, the read-only query, on the project's graph. */
async function query(projectId: string, cypher: string) {
  const res = await fetch(`${base}/api/query`, {
    method: "POST",
    headers: {
      "X-AM-Token": "ui-t",
      "X-AM-Actor": "human:ana",
      "Content-Type": "application/json",
      "X-AM-Project": projectId,
    },
    body: JSON.stringify({ graph: "client", cypher }),
  });
  return ((await res.json()) as { rows: unknown[][] }).rows;
}

async function rejected(projectId: string) {
  const [row] = await readQuery<{ p: { properties: Record<string, number> } }>(
    db,
    REGISTRY_GRAPH,
    "read/project",
    { projectId },
  );
  return row!.p.properties;
}

describe("Done when: two cards build at the same time with no lost writes", () => {
  it(
    "two workers each build a card at once, and both cards close",
    { timeout: 90_000 },
    async () => {
      const { ctx, taskIds } = await readyCards(["CARD-01", "CARD-02"]);
      const log = join(workspaces, "runs.log");
      process.env.FAKE_OC = "commit";
      process.env.FAKE_OC_LOG = log;
      const allDone = async () =>
        (await Promise.all(taskIds.map((id) => node(ctx, id)))).every((t) => t.column === "Done");
      await build(ctx, 2, allDone);

      expect(await allDone()).toBe(true);
      // Each worker ran one card, and the two runs overlapped.
      const runs = readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as { worker: string; start: number; end: number });
      expect(runs.map((r) => r.worker).sort()).toEqual(["build-1", "build-2"]);
      expect(Math.max(runs[0]!.start, runs[1]!.start)).toBeLessThan(
        Math.min(runs[0]!.end, runs[1]!.end),
      );
      // Every write landed: one build commit, one Run and one open merge item per card.
      expect(
        await query(
          ctx.projectId,
          q(
            "MATCH",
            "(t:Task)",
            "OPTIONAL MATCH",
            "(c:CodeChange)-[:FOR_TASK]->(t)",
            "WITH",
            "t, count(c) AS commits",
            "OPTIONAL MATCH",
            "(w:WorkItem {kind: 'merge', status: 'open'})",
            "WHERE",
            "w.subjectId = t.id",
            "RETURN",
            "t.key, commits, count(w) ORDER BY t.key",
          ),
        ),
      ).toEqual([
        ["CARD-01", 1, 1],
        ["CARD-02", 1, 1],
      ]);
      // One Run per card, written by its final step.
      expect(
        await query(ctx.projectId, q("MATCH", "(r:Run)", "RETURN", "r.itemId ORDER BY r.itemId")),
      ).toEqual([...taskIds].sort().map((id) => [id]));
      for (const id of taskIds) {
        expect(await node(ctx, id)).toMatchObject({ column: "Done", attempts: 0 });
      }
      const counters = await rejected(ctx.projectId);
      expect(counters.rejectedWrites ?? 0).toBe(0);
    },
  );

  it(
    "a run with no commit fails its attempt, and the second failure blocks the card",
    { timeout: 60_000 },
    async () => {
      const { ctx, taskIds } = await readyCards(["CARD-01"]);
      process.env.FAKE_OC = "nocommit";
      delete process.env.FAKE_OC_LOG;
      const attempts = async () => (await node(ctx, taskIds[0]!)).attempts as number;
      await build(ctx, 1, async () => (await attempts()) >= 2);
      const card = await node(ctx, taskIds[0]!);
      // Blocked at 2: claim_task skips it, so no third run.
      expect(card).toMatchObject({ column: "Ready", attempts: 2 });
      expect(card.note).toMatch(/commit/i);
    },
  );

  it(
    "leaves a card OpenCode closed itself alone: no second complete_task, nothing rejected",
    { timeout: 60_000 },
    async () => {
      const { ctx, taskIds } = await readyCards(["CARD-01"]);
      const log = join(workspaces, "selfclose.log");
      process.env.FAKE_OC = "selfclose"; // no commit: a worker complete_task would be NO_COMMIT
      process.env.FAKE_OC_LOG = log;
      await build(ctx, 1, async () => existsSync(log));
      expect(await node(ctx, taskIds[0]!)).toMatchObject({ attempts: 0, column: "In progress" });
      expect((await rejected(ctx.projectId)).rejectedWrites ?? 0).toBe(0);
    },
  );
});
