// Task 5.2, Done when: the report shows pass or fail for each check. The Launch agent's item, the
// readiness report (route 27) and G5 with its Deployment (T22, T23), through the real gateway
// against the real FalkorDB from docker-compose.yml. No mocks.
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  loadConfig,
  type Envelope,
  type GateView,
  type ReadinessCheck,
} from "@agencymem/contracts";
import { REGISTRY_GRAPH, close, connect, readQuery, type FalkorDB } from "@agencymem/graph";
import {
  approveDeploy,
  cancelItems,
  createGates,
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
import { createEvents } from "../events/bus";
import { createGateway } from "../main";

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

let shas = 0;
const nextSha = () => (++shas).toString(16).padStart(40, "f");

const props = async (ctx: Ctx, id: string) =>
  (
    await readQuery<{ n: { properties: Record<string, unknown> } }>(db, ctx.graph, "read/node", {
      id,
    })
  )[0]!.n.properties;

/**
 * A project in launch with REQ-01, built by CARD-01 and CARD-02 (two criteria each, with
 * TestCases), a passing e2e run of every case, and an open launch item. With `allDone` false,
 * CARD-02 is still Ready, so cards_done fails.
 */
async function launching(allDone: boolean) {
  const now = Date.now();
  const { project, client } = await createProject(db, {
    clientName: `test-client-${randomUUID()}`,
    projectName: "Launch",
    mode: "demo",
    createdBy: "human:test",
    now,
  });
  const ctx: Ctx = { db, graph: `client_${client.id}`, projectId: project.id };
  graphs.add(ctx.graph);
  await setStage(db, project.id, "intake", "launch");
  await createGates(ctx, { keys: ["G1", "G2", "G3", "G5"], createdBy: "human:test", now });
  const { episodeIds } = await writeDocument(ctx, {
    name: "notes.pdf",
    mime: "application/pdf",
    sha256: "f".repeat(64),
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
  const cards = [1, 2].map((n) => ({
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
  }));
  const { taskIds } = (await writeCards(ctx, {
    cards: cards as never,
    createdBy: "planner",
    now,
  }))!;
  const cases: string[] = [];
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
    cases.push(...written!.testCaseIds);
  }
  for (const id of allDone ? taskIds : taskIds.slice(0, 1)) {
    const { version } = await props(ctx, id);
    await writeVersioned(ctx, {
      id,
      version: Number(version),
      props: { column: "Done", mergedSha: nextSha() },
    });
  }
  // The e2e run on main passed every case (task 5.1).
  const e2e = await openItem(ctx, { kind: "e2e", createdBy: "build", now });
  const tester = await session(project.id, "test", "test-e2e-1");
  await call(tester, "claim_item", { kinds: ["e2e"] });
  await call(tester, "submit_test_run", {
    itemId: e2e!.id,
    sha: nextSha(),
    results: cases.map((testCaseId) => ({ testCaseId, passed: true, durationMs: 1 })),
  });
  const launch = await openItem(ctx, { kind: "launch", createdBy: "test", now });
  return { ctx, itemId: launch!.id };
}

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

const ui = (projectId: string) => ({
  "X-AM-Token": "ui-t",
  "X-AM-Actor": "human:lead",
  "X-AM-Project": projectId,
  "Content-Type": "application/json",
});

async function g5(projectId: string): Promise<GateView> {
  const res = await fetch(`${base}/api/projects/${projectId}/gates`, { headers: ui(projectId) });
  const { gates } = (await res.json()) as { gates: GateView[] };
  return gates.find((g) => g.key === "G5")!;
}

async function decide(projectId: string, body: Record<string, unknown>) {
  const gate = await g5(projectId);
  const res = await fetch(`${base}/api/gates/${gate.id}/decision`, {
    method: "POST",
    headers: ui(projectId),
    body: JSON.stringify({ version: gate.version, decision: "approve", ...body }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function readiness(projectId: string) {
  const res = await fetch(`${base}/api/projects/${projectId}/readiness`, {
    headers: ui(projectId),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    report: { id: string; passed: boolean; override: boolean; checks: ReadinessCheck[] } | null;
  };
}

const stage = async (projectId: string) =>
  (
    await readQuery<{ p: { properties: Record<string, unknown> } }>(
      db,
      REGISTRY_GRAPH,
      "read/project",
      { projectId },
    )
  )[0]!.p.properties.stage;

const drift: ReadinessCheck = {
  name: "drift",
  passed: true,
  detail: "All 2 commits on main are recorded",
  nodeIds: [],
};

/** The Launch agent's run: recall the four checks, hand off all five, complete the item. */
async function runLaunch(projectId: string, itemId: string) {
  const launch = await session(projectId, "launch", "launch-1");
  await call(launch, "claim_item", { kinds: ["launch"] });
  const { out } = await call(launch, "recall_context", { itemId });
  const checks = (out as { context: { readiness: ReadinessCheck[] } }).context.readiness;
  await call(launch, "write_handoff", {
    itemId,
    summary: "Readiness",
    outputIds: [],
    report: { checks: [...checks, drift] },
  });
  await call(launch, "complete_item", { itemId, outcome: "done", summary: "Readiness", runs: [] });
  return checks;
}

describe("the Launch agent's readiness report (task 5.2)", () => {
  it("recalls the four graph checks, and route 27 shows pass or fail for each of the five", async () => {
    const { ctx, itemId } = await launching(false);
    expect(await readiness(ctx.projectId)).toEqual({ report: null });
    expect((await g5(ctx.projectId)).blockedBy).toEqual(["Launch is still checking"]);

    const checks = await runLaunch(ctx.projectId, itemId);
    expect(checks.map((c) => [c.name, c.passed])).toEqual([
      ["cards_done", false],
      ["coverage", true],
      ["open_assumptions", true],
      ["open_defects", true],
    ]);
    expect(checks[0]).toMatchObject({ detail: "1 of 2 cards are not Done" });
    expect(checks[0]!.nodeIds).toHaveLength(1);

    const { report } = await readiness(ctx.projectId);
    expect(report).toMatchObject({ passed: false, override: false });
    expect(report!.checks.map((c) => [c.name, c.passed])).toEqual([
      ["cards_done", false],
      ["coverage", true],
      ["open_assumptions", true],
      ["open_defects", true],
      ["drift", true],
    ]);
  });

  it("G5: a failed report needs environment, override and a reason; the approval records a Deployment and starts maintenance", async () => {
    const { ctx, itemId } = await launching(false);
    await runLaunch(ctx.projectId, itemId);
    expect(await g5(ctx.projectId)).toMatchObject({ canDecide: true, blockedBy: [] });

    expect((await decide(ctx.projectId, {})).status).toBe(400); // no environment
    expect((await decide(ctx.projectId, { environment: "demo" })).status).toBe(400); // no override
    expect((await decide(ctx.projectId, { environment: "demo", override: true })).status).toBe(400); // no reason

    const sent: Envelope[] = [];
    const off = events.on((e) => e.projectId === ctx.projectId && sent.push(e));
    const done = await decide(ctx.projectId, {
      environment: "demo",
      override: true,
      reason: "demo run",
    });
    off();
    expect(done.status).toBe(200);
    expect(done.body.gate).toMatchObject({ key: "G5", status: "approved", reason: "demo run" });
    const deployment = sent.find(
      (e) => e.type === "node.written" && (e.data as { label: string }).label === "Deployment",
    );
    expect(await props(ctx, (deployment!.data as { id: string }).id)).toMatchObject({
      environment: "demo",
      deployedBy: "human:lead",
    });
    expect((await readiness(ctx.projectId)).report).toMatchObject({ override: true });
    expect(await stage(ctx.projectId)).toBe("maintenance");
  });

  it("G5: a passing report is approved with the environment alone", async () => {
    const { ctx, itemId } = await launching(true);
    const checks = await runLaunch(ctx.projectId, itemId);
    expect(checks.every((c) => c.passed)).toBe(true);
    expect((await readiness(ctx.projectId)).report).toMatchObject({ passed: true });
    const done = await decide(ctx.projectId, { environment: "demo" });
    expect(done.status).toBe(200);
    expect(await stage(ctx.projectId)).toBe("maintenance");
  });

  it("G5: a report whose launch item T30 cancelled no longer counts", async () => {
    const { ctx, itemId } = await launching(true);
    await runLaunch(ctx.projectId, itemId);
    // A card left Done: T30 cancelled the run, and a new launch item has not finished.
    await openItem(ctx, { kind: "launch", createdBy: "test", now: Date.now() + 1 });
    expect((await g5(ctx.projectId)).blockedBy).toEqual(["Launch is still checking"]);
    await cancelItems(ctx, { kinds: ["launch"] });
    expect(await g5(ctx.projectId)).toMatchObject({
      canDecide: false,
      blockedBy: ["No readiness report"],
    });
  });

  it("approveDeploy writes nothing at an old version or on a decided gate (one query)", async () => {
    const { ctx, itemId } = await launching(true);
    await runLaunch(ctx.projectId, itemId);
    const gate = await g5(ctx.projectId);
    const input = {
      gateId: gate.id,
      environment: "demo",
      override: false,
      reason: null,
      actor: "human:lead" as const,
      now: Date.now(),
    };
    expect(await approveDeploy(ctx, { ...input, version: gate.version + 1 })).toBeNull();
    expect(await approveDeploy(ctx, { ...input, version: gate.version })).not.toBeNull();
    expect(await approveDeploy(ctx, { ...input, version: gate.version + 1 })).toBeNull(); // approved
    const nodes = await readQuery<{ label: string }>(db, ctx.graph, "read/graph-nodes", {
      projectId: ctx.projectId,
      limit: 500,
    });
    expect(nodes.filter((n) => n.label === "Deployment")).toHaveLength(1);
  });
});
