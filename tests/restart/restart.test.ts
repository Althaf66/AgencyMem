// Task 6.2, Done when: the project finishes after the restart. A runner (tests/restart/runner.ts:
// one build worker on the fake OpenCode, and the merge loop) is killed during a card. The lease
// ends, the gateway's sweeper sends the card back to Ready (contracts.md section 10), a new runner
// takes it in the same worktree, and every card ends Done and merged, so the stage moves to e2e
// (T20). Real gateway, FalkorDB, git and post-commit hook; no mocks. "Finishes" is the build stage
// (developer decision 2026-10-17): the later stages need the model agents.
import { execFile, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
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
  type Ctx,
} from "@agencymem/memory";
import { createEvents } from "../../apps/gateway/src/events/bus";
import { createGateway } from "../../apps/gateway/src/main";
import { openSession } from "../../apps/runner/src/mcp-client";
import { ensureRepo } from "../../apps/runner/src/repo";

const run = promisify(execFile);
const win = process.platform === "win32";
const TOKENS = { AM_AGENT_TOKEN: "agent-t", AM_UI_TOKEN: "ui-t", AM_HOOK_TOKEN: "hook-t" };
const FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";
const LEASE_MS = 3_000;
const SWEEP_MS = 500;
const HEARTBEAT_MS = 500;
const RUNNER = fileURLToPath(new URL("./runner.ts", import.meta.url));

let db: FalkorDB;
let server: Server;
let base: string;
const events = createEvents();
const graphs = new Set<string>();
const runners: ChildProcess[] = [];
const workspaces = mkdtempSync(join(tmpdir(), "am-ws-"));

beforeAll(async () => {
  db = await connect(FALKORDB_URL);
  const cfg = loadConfig({ ...TOKENS, FALKORDB_URL, LEASE_MS: String(LEASE_MS) }, "gateway");
  server = createGateway(cfg, { events, sweepMs: SWEEP_MS });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  for (const runner of runners) stopRunner(runner);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  for (const graph of graphs) await deleteTestClient(db, graph);
  await close();
  rmSync(workspaces, { recursive: true, force: true });
});

/** Starts the runner as its own process, as `pnpm dev` does. */
function startRunner(projectId: string, fake: "commit-hang" | "commit"): ChildProcess {
  const child = spawn(process.execPath, ["--import", "tsx", RUNNER], {
    env: {
      ...process.env,
      GATEWAY_URL: base,
      AM_PROJECT_ID: projectId,
      WORKSPACES_DIR: workspaces,
      HEARTBEAT_MS: String(HEARTBEAT_MS),
      FAKE_OC: fake,
    },
    stdio: "ignore",
    detached: !win, // its own process group, so the kill reaches the whole runner
  });
  runners.push(child);
  return child;
}

/** Kills the runner with no chance to clean up, like a crash. */
function stopRunner(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) return;
  if (win) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // the group is already gone
    }
  }
}

async function until(what: string, check: () => Promise<boolean>, ms: number) {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

const node = async (ctx: Ctx, id: string) =>
  (
    await readQuery<{ n: { properties: Record<string, unknown> } }>(db, ctx.graph, "read/node", {
      id,
    })
  )[0]!.n.properties;

const project = async (projectId: string) =>
  (
    await readQuery<{ p: { properties: Record<string, unknown> } }>(
      db,
      REGISTRY_GRAPH,
      "read/project",
      { projectId },
    )
  )[0]!.p.properties;

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

/** The build commits per card, oldest first. */
const commits = (projectId: string) =>
  query(
    projectId,
    q(
      "MATCH",
      "(t:Task)",
      "OPTIONAL MATCH",
      "(c:CodeChange)-[:FOR_TASK]->(t)",
      "RETURN",
      "t.key, count(c) ORDER BY t.key",
    ),
  );

/** Two Ready cards with one TestCase each, their branches made, in a project in build. */
async function readyCards(keys: string[]) {
  const now = Date.now();
  const { project: p, client } = await createProject(db, {
    clientName: `test-client-${randomUUID()}`,
    projectName: "Restart",
    mode: "demo",
    createdBy: "human:test",
    now,
  });
  const ctx: Ctx = { db, graph: `client_${client.id}`, projectId: p.id };
  graphs.add(ctx.graph);
  await setStage(db, p.id, "intake", "build");
  const { episodeIds } = await writeDocument(ctx, {
    name: "notes.pdf",
    mime: "application/pdf",
    sha256: "6".repeat(64),
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
  return { ctx, taskIds, repo };
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

describe("Done when: the project finishes after the restart", () => {
  it(
    "a runner killed during a card loses its lease, the card goes back to Ready, and a new runner finishes the build",
    { timeout: 150_000 },
    async () => {
      const { ctx, taskIds, repo } = await readyCards(["CARD-01", "CARD-02"]);
      const [card1] = taskIds as [string, string];
      const sent: Envelope[] = [];
      const off = events.on((e) => e.projectId === ctx.projectId && sent.push(e));
      const stop = new AbortController();
      const tests = passEveryRun(ctx.projectId, stop.signal);

      try {
        // 1. The first runner commits on CARD-01, then its OpenCode hangs: the card is mid-run.
        const first = startRunner(ctx.projectId, "commit-hang");
        await until(
          "the first commit on CARD-01",
          async () => (await commits(ctx.projectId))[0]![1] === 1,
          60_000,
        );
        expect((await node(ctx, card1)).leaseOwner).toBe("build-1");

        // 2. Kill it. The heartbeats stop, the lease ends, and the sweeper frees the card.
        stopRunner(first);
        await until(
          "the sweeper to free CARD-01",
          async () => (await node(ctx, card1)).column === "Ready",
          LEASE_MS + 10 * SWEEP_MS,
        );
        expect(await node(ctx, card1)).toMatchObject({ column: "Ready", attempts: 1 });
        const freed = sent.filter(
          (e) =>
            (e.type === "lease.changed" && e.data.itemId === card1 && e.data.reason === "expire") ||
            (e.type === "task.moved" && e.data.taskId === card1 && e.data.to === "Ready"),
        );
        expect(freed.map((e) => e.type)).toEqual(["lease.changed", "task.moved"]);

        // 3. A new runner takes the card in the same worktree, and the project finishes the build.
        startRunner(ctx.projectId, "commit");
        await until(
          "the build stage to finish (stage e2e)",
          async () => (await project(ctx.projectId)).stage === "e2e",
          90_000,
        );
      } finally {
        // Also on a failed step, so the stand-in Test agent and the listener never outlive it.
        stop.abort();
        await tests.catch(() => undefined);
        off();
      }

      for (const id of taskIds) {
        const card = await node(ctx, id);
        expect(card.column).toBe("Done");
        expect(card.mergedSha).toEqual(expect.any(String));
      }
      expect((await node(ctx, card1)).attempts).toBe(1);
      // Two build commits on CARD-01, the stopped run's kept in its worktree, one on CARD-02.
      expect(await commits(ctx.projectId)).toEqual([
        ["CARD-01", 2],
        ["CARD-02", 1],
      ]);
      // The new run built on the stopped run's commit: both are on the card branch, one after the
      // other (the worktree itself is removed after the merge, task 4.3).
      const log = await run("git", ["log", "--first-parent", "--format=%s", "card/CARD-01"], {
        cwd: repo,
      });
      expect(log.stdout.split("\n").slice(0, 2)).toEqual(["feat: build", "feat: build"]);
      expect(sent.filter((e) => e.type === "write.rejected").map((e) => e.data)).toEqual([]);
      expect((await project(ctx.projectId)).rejectedWrites ?? 0).toBe(0);
    },
  );
});
