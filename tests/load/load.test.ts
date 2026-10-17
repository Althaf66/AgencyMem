// Task 6.1, Done when: 0 lost writes; the report lists claims, rejected claims and rejected writes.
// 20 build workers claim, renew and complete cards over MCP while one human script edits them over
// REST, through the real gateway against the real FalkorDB from docker-compose.yml. No mocks.
// A lost write (developer decision 2026-10-17) got an OK reply, but its value or version is not in
// the graph at the end.
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  loadConfig,
  rejectionCounter,
  type CardView,
  type GuardName,
  type ReasonCode,
} from "@agencymem/contracts";
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
import { createGateway } from "../../apps/gateway/src/main";
import { ToolRejected, openSession, type Session } from "../../apps/runner/src/mcp-client";

const TOKENS = { AM_AGENT_TOKEN: "agent-t", AM_UI_TOKEN: "ui-t", AM_HOOK_TOKEN: "hook-t" };
const FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";
const WORKERS = 20;
// The run lasts until the person has made this many edits, so workers and person overlap all along.
const HUMAN_EDITS = 40;
const CARDS = 24;
const REPORT = new URL("./out/report.json", import.meta.url);

let db: FalkorDB;
let server: Server;
let base: string;
const graphs = new Set<string>();
const sessions: Session[] = [];

beforeAll(async () => {
  db = await connect(FALKORDB_URL);
  server = createGateway(loadConfig({ ...TOKENS, FALKORDB_URL }, "gateway"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await Promise.allSettled(sessions.map((s) => s.close()));
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  for (const graph of graphs) await deleteTestClient(db, graph);
  await close();
});

const key = (n: number) => `CARD-${String(n).padStart(2, "0")}`;
const card = (n: number) => ({
  key: key(n),
  title: `Card ${n}`,
  description: `Builds part ${n}.`,
  lane: "Backend",
  order: n * 10,
  requirementKey: "REQ-01",
  designKeys: [],
  // CARD-01 never reaches Done, so a claim of one of these by id is a counted DEPS_OPEN.
  dependsOn: n > CARDS - 4 ? [key(1)] : [],
  criteria: [{ key: `AC-${String(n).padStart(2, "0")}-1`, text: `Part ${n} works.`, testIds: [] }],
});

/** A project in build with CARD-01..24 on REQ-01, all Ready (each criterion has a TestCase). */
async function setup() {
  const now = Date.now();
  const { project, client } = await createProject(db, {
    clientName: `test-client-${randomUUID()}`,
    projectName: "Load",
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
    sha256: "d".repeat(64),
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
  const cards = Array.from({ length: CARDS }, (_, i) => card(i + 1));
  const { taskIds } = (await writeCards(ctx, {
    cards: cards as never,
    createdBy: "planner",
    now,
  }))!;
  for (const [i, taskId] of taskIds.entries()) {
    await writeTests(ctx, {
      taskId,
      cases: [
        { criterionKey: cards[i]!.criteria[0]!.key, file: `tests/e2e/${i}.spec.ts`, title: "t" },
      ],
      createdBy: "test",
      now,
    });
  }
  return { ctx, ids: taskIds };
}

type Counters = { rejectedClaims: number; rejectedWrites: number };
async function counters(projectId: string): Promise<Counters> {
  const params = { projectId };
  const [row] = await readQuery<{ p: { properties: Counters } }>(
    db,
    REGISTRY_GRAPH,
    "read/project",
    params,
  );
  const { rejectedClaims, rejectedWrites } = row!.p.properties;
  return { rejectedClaims, rejectedWrites };
}

type Rejected = { code: string; guard?: GuardName; details?: { reasonCode?: string } };

/** What the clients saw: OK writes per card, and every counted rejection. */
const seen = {
  claims: 0,
  acks: new Map<string, number>(), // card id -> OK replies that raised its version
  // card id -> the versions claim_task and complete_task answered (their own query's RETURN; the
  // PATCH answer reads the card again, so it may show a later write and is left out)
  versions: new Map<string, number[]>(),
  titles: new Map<string, string>(), // card id -> the last title a person got a 200 for
  counted: { rejectedClaims: 0, rejectedWrites: 0 } as Record<string, number>,
  humanEdits: 0,
};
const ack = (id: string, version?: number) => {
  seen.acks.set(id, (seen.acks.get(id) ?? 0) + 1);
  if (version !== undefined) seen.versions.set(id, [...(seen.versions.get(id) ?? []), version]);
};
function count(error: Rejected) {
  if (!error.guard) return; // VALIDATION_FAILED and NOT_FOUND are not guard rejections
  const counter = rejectionCounter(error.guard, error.details!.reasonCode as ReasonCode<GuardName>);
  if (counter) seen.counted[counter] = (seen.counted[counter] ?? 0) + 1;
}

async function worker(projectId: string, workerId: string): Promise<Session> {
  const session = await openSession(
    { gatewayUrl: base, token: "agent-t" },
    { agent: "build", projectId, workerId },
  );
  sessions.push(session);
  return session;
}

/** One MCP call: its output, or null after counting its rejection. */
async function call<T>(attempt: Promise<T>): Promise<T | null> {
  try {
    return await attempt;
  } catch (e) {
    if (!(e instanceof ToolRejected)) throw e;
    count(e.rejection as Rejected);
    return null;
  }
}

const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]!;

async function workerRun(session: Session, ids: string[], running: () => boolean) {
  for (let round = 0; running(); round++) {
    // An even round names a random card, so workers race for the same card.
    const args = round % 2 === 0 ? { taskId: pick(ids) } : {};
    const task = (await call(session.call("claim_task", args)))?.task;
    if (!task) {
      await sleep(10); // every free card is leased or Blocked until the person edits again
      continue;
    }
    seen.claims++;
    ack(task.id, task.version);
    await call(session.call("heartbeat", { itemId: task.id }));
    const done = await call(
      session.call("complete_task", {
        taskId: task.id,
        version: task.version,
        outcome: "failed",
        note: "Load test run.",
      }),
    );
    if (done) ack(done.task.id, done.task.version);
  }
}

const ui = (projectId: string) => ({
  "X-AM-Token": "ui-t",
  "X-AM-Actor": "human:load",
  "X-AM-Project": projectId,
  "Content-Type": "application/json",
});

async function cardsOf(projectId: string): Promise<CardView[]> {
  const res = await fetch(`${base}/api/projects/${projectId}/board`, { headers: ui(projectId) });
  return ((await res.json()) as { cards: CardView[] }).cards;
}

/** One person editing cards one after another until HUMAN_EDITS edits went through. */
async function humanRun(projectId: string) {
  while (seen.humanEdits < HUMAN_EDITS) {
    const cards = await cardsOf(projectId);
    // Turn about: a card a worker holds (human wins cancels its lease, so the worker's
    // complete_task is refused), then a Blocked card (H6 unblock keeps work flowing).
    const leased = cards.filter((c) => c.leaseHolder !== null);
    const blocked = cards.filter((c) => c.blocked);
    const first = seen.humanEdits % 2 === 0 ? leased : blocked;
    const target = pick(first.length ? first : blocked.length ? blocked : cards);
    const title = `Load edit ${seen.humanEdits}`;
    const res = await fetch(`${base}/api/tasks/${target.id}`, {
      method: "PATCH",
      headers: ui(projectId),
      body: JSON.stringify({
        version: target.version,
        title,
        ...(target.blocked ? { unblock: true } : {}),
      }),
    });
    const body = (await res.json()) as { error?: Rejected };
    if (res.ok) {
      seen.humanEdits++;
      ack(target.id);
      seen.titles.set(target.id, title);
    } else count(body.error!);
  }
}

describe("Done when: 0 lost writes; the report lists claims, rejected claims and rejected writes", () => {
  it("20 workers and one person on 24 cards lose no write, and every rejection is counted", async () => {
    const { ctx, ids } = await setup();
    const start = new Map((await cardsOf(ctx.projectId)).map((c) => [c.id, c.version]));
    const before = await counters(ctx.projectId);
    const workers = await Promise.all(
      Array.from({ length: WORKERS }, (_, i) => worker(ctx.projectId, `build-${i + 1}`)),
    );

    const t0 = Date.now();
    let running = true;
    const runs = workers.map((w) => workerRun(w, ids, () => running));
    await humanRun(ctx.projectId);
    running = false;
    await Promise.all(runs);
    const ms = Date.now() - t0;

    const after = await counters(ctx.projectId);
    const end = await cardsOf(ctx.projectId);
    let lostWrites = 0;
    for (const c of end) {
      // Each OK write raised the version by one, so a lost update leaves fewer versions than acks.
      lostWrites += Math.abs((seen.acks.get(c.id) ?? 0) - (c.version - start.get(c.id)!));
      // Two OK writes that answered one version, or a version above the stored one, lost a write.
      // This also catches a refused write that changed the card and offsets a lost one above.
      const versions = seen.versions.get(c.id) ?? [];
      lostWrites += versions.length - new Set(versions).size;
      lostWrites += versions.filter((v) => v > c.version).length;
      const title = seen.titles.get(c.id);
      if (title !== undefined && c.title !== title) lostWrites++;
    }
    const report = {
      projectId: ctx.projectId,
      workers: WORKERS,
      claims: seen.claims,
      rejectedClaims: after.rejectedClaims - before.rejectedClaims,
      rejectedWrites: after.rejectedWrites - before.rejectedWrites,
      humanEdits: seen.humanEdits,
      lostWrites,
      ms,
    };
    mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
    writeFileSync(
      REPORT,
      `${JSON.stringify(report, null, 2)}
`,
    );
    console.log("load test report", report);

    expect(lostWrites).toBe(0);
    // Every rejection a client saw was counted on the Project, and none more.
    expect(report.rejectedClaims).toBe(seen.counted.rejectedClaims);
    expect(report.rejectedWrites).toBe(seen.counted.rejectedWrites);
    // The run really raced: claims won and lost, and writes refused.
    expect(report.claims).toBeGreaterThan(HUMAN_EDITS);
    expect(report.rejectedClaims).toBeGreaterThan(0);
    expect(report.rejectedWrites).toBeGreaterThan(0);
    // Every run ended (completed, or its lease cancelled by a person), so no lease is left.
    expect(end.filter((c) => c.leaseHolder !== null)).toEqual([]);
  }, 120_000);
});
