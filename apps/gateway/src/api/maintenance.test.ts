// Task 5.3, Done when: a backtrace path reaches a client episode; a fix card waits for G6. A bug
// report (route 28, T24), the Maintenance agent's report_defect and propose_fix, the backtrace
// (route 19) and G6 (T26, T27), through the real gateway against the real FalkorDB from
// docker-compose.yml. No mocks.
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type CardView, type GateView, type GraphView } from "@agencymem/contracts";
import { REGISTRY_GRAPH, close, connect, readQuery, type FalkorDB } from "@agencymem/graph";
import {
  completeTask,
  createChangeRequest,
  flagImpact,
  openItem,
  createGates,
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
import { createEvents } from "../events/bus";
import { createGateway } from "../main";
import { readStageState } from "../stage/state";

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
const nextSha = () => (++shas).toString(16).padStart(40, "b");

const props = async (ctx: Ctx, id: string) =>
  (
    await readQuery<{ n: { properties: Record<string, unknown> } }>(db, ctx.graph, "read/node", {
      id,
    })
  )[0]!.n.properties;

const ui = (projectId: string) => ({
  "X-AM-Token": "ui-t",
  "X-AM-Actor": "human:lead",
  "X-AM-Project": projectId,
  "Content-Type": "application/json",
});

async function rest(projectId: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: ui(projectId),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
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

/**
 * A project in launch (moved to maintenance by the test) with the client's line "No slots from
 * 13:00 to 14:00." as a file_chunk episode, its Fact, REQ-01 derived from it, CARD-01 (Done) that
 * implements it, and one linked build commit on CARD-01 through the hook route.
 */
async function deployed() {
  const now = Date.now();
  const { project, client } = await createProject(db, {
    clientName: `test-client-${randomUUID()}`,
    projectName: "Maintenance",
    mode: "demo",
    createdBy: "human:test",
    now,
  });
  const ctx: Ctx = { db, graph: `client_${client.id}`, projectId: project.id };
  graphs.add(ctx.graph);
  await setStage(db, project.id, "intake", "launch");
  await createGates(ctx, { keys: ["G1", "G2", "G3", "G5"], createdBy: "human:test", now });
  const { episodeIds } = await writeDocument(ctx, {
    name: "kickoff-notes.pdf",
    mime: "application/pdf",
    sha256: "a".repeat(64),
    status: "processed",
    wordCount: 7,
    error: null,
    episodes: [{ page: 1, lineStart: 4, lineEnd: 4, text: "No slots from 13:00 to 14:00." }],
    createdBy: "human:test",
    now,
  });
  const { factIds } = await writeFacts(ctx, {
    entities: [{ key: "clinic", name: "Clinic", aliases: [] }],
    facts: [
      {
        statement: "There are no slots from 13:00 to 14:00.",
        subject: "clinic",
        attribute: "lunch_break",
        value: "13:00 to 14:00",
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
      { key: "REQ-01", text: "No slots in the lunch break.", priority: "must", factIds },
    ],
    features: [
      {
        key: "FEAT-01",
        name: "Slot calendar",
        featureKind: "calendar",
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
        title: "Slot calendar API",
        description: "Lists the free slots.",
        lane: "Backend",
        order: 10,
        requirementKey: "REQ-01",
        designKeys: [],
        dependsOn: [],
        criteria: [{ key: "AC-01-1", text: "Given, when, then.", testIds: [] }],
      },
    ] as never,
    createdBy: "planner",
    now,
  }))!;
  const card = taskIds[0]!;
  const { version } = await props(ctx, card);
  await writeVersioned(ctx, {
    id: card,
    version: Number(version),
    props: { column: "Done", mergedSha: nextSha() },
  });
  const res = await fetch(`${base}/hooks/commit`, {
    method: "POST",
    headers: { "X-AM-Token": "hook-t", "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: project.id,
      sha: nextSha(),
      branch: "card/CARD-01",
      files: ["server/slots.ts"],
      message: "feat(CARD-01): slots",
      author: "agencymem",
      committedAt: now,
    }),
  });
  const { codeChangeId } = (await res.json()) as { codeChangeId: string };
  return { ctx, card, codeChangeId, episodeId: episodeIds[0]!, factId: factIds[0]! };
}

const fixCard = (n: number) => ({
  key: `CARD-0${n}`,
  title: "Hide lunch slots",
  description: "No slot between 13:00 and 14:00.",
  lane: "Backend",
  order: n * 10,
  requirementKey: "REQ-01",
  designKeys: [],
  dependsOn: [],
  criteria: [
    {
      key: `AC-0${n}-1`,
      text: "Given a lunch break 13:00 to 14:00, when the patient opens `slots-day`, then no `slots-slot-1320` is shown.",
      testIds: ["slots-day", "slots-slot-1320"],
    },
  ],
});

/** Route 28, then the Maintenance agent's report_defect and propose_fix for CARD-0<n>. */
async function reportAndFix(ctx: Ctx, codeChangeId: string, n: number) {
  const report = await rest(ctx.projectId, "POST", `/api/projects/${ctx.projectId}/bug-reports`, {
    text: "A patient booked a slot at 1:20 pm, during the lunch break.",
  });
  expect(report.status).toBe(201);
  const { episodeId, workItemId } = report.body as { episodeId: string; workItemId: string };
  const maintenance = await session(ctx.projectId, "maintenance", `maintenance-${n}`);
  await call(maintenance, "claim_item", { itemId: workItemId, kinds: ["maintenance"] });
  const { out: defect } = await call(maintenance, "report_defect", {
    itemId: workItemId,
    title: "A slot is offered in the lunch break",
    severity: "high",
    codeChangeId,
    reportEpisodeId: episodeId,
    reasoning: "REQ-01 says no slots from 13:00 to 14:00; CARD-01 builds the slot list.",
  });
  const { defectId } = defect as { defectId: string };
  const { out: fix } = await call(maintenance, "propose_fix", {
    itemId: workItemId,
    defectId,
    card: fixCard(n),
  });
  const { taskId, gateId } = fix as { taskId: string; gateId: string };
  return { maintenance, episodeId, workItemId, defectId, taskId, gateId };
}

const boardCard = async (ctx: Ctx, key: string) =>
  (
    (await rest(ctx.projectId, "GET", `/api/projects/${ctx.projectId}/board`)).body
      .cards as CardView[]
  ).find((c) => c.key === key)!;
const gateOf = async (ctx: Ctx, id: string) =>
  (
    (await rest(ctx.projectId, "GET", `/api/projects/${ctx.projectId}/gates`)).body
      .gates as GateView[]
  ).find((g) => g.id === id)!;
const testFix = (ctx: Ctx, taskId: string, n: number) =>
  writeTests(ctx, {
    taskId,
    cases: [
      { criterionKey: `AC-0${n}-1`, file: `tests/e2e/CARD-0${n}/AC-0${n}-1.spec.ts`, title: "t" },
    ],
    createdBy: "test",
    now: Date.now(),
  });

describe("the Maintenance agent's path (task 5.3)", () => {
  it("takes bug reports only after the deploy (route 28, 409 before)", async () => {
    const { ctx } = await deployed();
    const early = await rest(ctx.projectId, "POST", `/api/projects/${ctx.projectId}/bug-reports`, {
      text: "It breaks.",
    });
    expect(early.status).toBe(409);
    await setStage(db, ctx.projectId, "launch", "maintenance");
    const report = await rest(ctx.projectId, "POST", `/api/projects/${ctx.projectId}/bug-reports`, {
      text: "It breaks.",
    });
    expect(report.status).toBe(201);
    const { episodeId, workItemId } = report.body as { episodeId: string; workItemId: string };
    expect(await props(ctx, episodeId)).toMatchObject({ kind: "bug_report", text: "It breaks." });
    expect(await props(ctx, workItemId)).toMatchObject({
      kind: "maintenance",
      status: "open",
      subjectId: episodeId,
    });
  });

  it("recalls the report and the linked commits, and refuses a commit that is not the project's", async () => {
    const { ctx, codeChangeId } = await deployed();
    await setStage(db, ctx.projectId, "launch", "maintenance");
    const report = await rest(ctx.projectId, "POST", `/api/projects/${ctx.projectId}/bug-reports`, {
      text: "A slot at 1:20 pm.",
    });
    const { episodeId, workItemId } = report.body as { episodeId: string; workItemId: string };
    const maintenance = await session(ctx.projectId, "maintenance", "maintenance-1");
    await call(maintenance, "claim_item", { kinds: ["maintenance"] });
    const { out } = await call(maintenance, "recall_context", { itemId: workItemId });
    const context = (out as { context: Record<string, unknown> }).context;
    expect(context.defect).toEqual({ reportEpisodeId: episodeId, text: "A slot at 1:20 pm." });
    expect(context.codeChanges).toEqual([
      expect.objectContaining({ id: codeChangeId, taskKey: "CARD-01", linked: true }),
    ]);
    expect((context.requirements as { key: string }[]).map((r) => r.key)).toEqual(["REQ-01"]);
    expect((context.tasks as { key: string }[]).map((t) => t.key)).toEqual(["CARD-01"]);

    const args = {
      itemId: workItemId,
      title: "t",
      severity: "low",
      reportEpisodeId: episodeId,
      reasoning: "r",
    };
    const unknown = await call(maintenance, "report_defect", {
      ...args,
      codeChangeId: "01JA0000000000000000000099",
    });
    expect(unknown.error).toMatchObject({ guard: "source" });
    const otherEpisode = await call(maintenance, "report_defect", {
      ...args,
      codeChangeId,
      reportEpisodeId: codeChangeId,
    });
    expect(otherEpisode.error).toMatchObject({ guard: "source" });
  });

  it("Done when: the backtrace reaches the client's words, and the fix card waits for G6 (T26)", async () => {
    const { ctx, card, codeChangeId, episodeId } = await deployed();
    await setStage(db, ctx.projectId, "launch", "maintenance");
    const fix = await reportAndFix(ctx, codeChangeId, 2);
    expect(await props(ctx, fix.defectId)).toMatchObject({ status: "fixing", severity: "high" });

    // Route 19: Defect -> CodeChange -> Task -> Requirement -> Fact -> Episode.
    const back = await rest(
      ctx.projectId,
      "GET",
      `/api/projects/${ctx.projectId}/backtrace/${fix.defectId}`,
    );
    expect(back.status).toBe(200);
    const path = back.body.path as GraphView;
    const ids = new Set(path.nodes.map((n) => n.id));
    for (const id of [fix.defectId, codeChangeId, card, episodeId]) expect(ids).toContain(id);
    expect(new Set(path.nodes.map((n) => n.label))).toEqual(
      new Set(["Defect", "CodeChange", "Task", "Requirement", "Fact", "Episode"]),
    );
    expect(await props(ctx, episodeId)).toMatchObject({ kind: "file_chunk" });
    expect(typeof back.body.ms).toBe("number");
    const [project] = await readQuery<{ p: { properties: Record<string, unknown> } }>(
      db,
      REGISTRY_GRAPH,
      "read/project",
      { projectId: ctx.projectId },
    );
    expect(typeof project!.p.properties.backtraceMs).toBe("number");

    // The fix card waits for G6.
    const fixView = await boardCard(ctx, "CARD-02");
    expect(fixView).toMatchObject({
      id: fix.taskId,
      kind: "fix",
      column: "Backlog",
      gate: { id: fix.gateId, key: "G6", status: "waiting" },
    });
    expect(await gateOf(ctx, fix.gateId)).toMatchObject({
      key: "G6",
      canDecide: true,
      task: { id: fix.taskId, key: "CARD-02" },
    });
    await testFix(ctx, fix.taskId, 2);
    expect(await boardCard(ctx, "CARD-02")).toMatchObject({ column: "Backlog" });
    const h2 = await rest(ctx.projectId, "PATCH", `/api/tasks/${fix.taskId}`, {
      version: (await boardCard(ctx, "CARD-02")).version,
      column: "Ready",
    });
    expect(h2.status).toBe(409);

    // T26: approved, the Test agent writes its specs, and then the card is Ready.
    const gate = await gateOf(ctx, fix.gateId);
    const approved = await rest(ctx.projectId, "POST", `/api/gates/${fix.gateId}/decision`, {
      version: gate.version,
      decision: "approve",
    });
    expect(approved.status).toBe(200);
    expect(approved.body.opened).toEqual([expect.objectContaining({ kind: "write_tests" })]);
    const opened = (approved.body.opened as { id: string }[])[0]!;
    expect(await props(ctx, opened.id)).toMatchObject({ subjectId: fix.taskId });
    await testFix(ctx, fix.taskId, 2);
    expect(await boardCard(ctx, "CARD-02")).toMatchObject({ column: "Ready" });

    // Approved decision 7: the fix card reaching Done fixes its Defect.
    const ready = await props(ctx, fix.taskId);
    await writeVersioned(ctx, {
      id: fix.taskId,
      version: Number(ready.version),
      props: { column: "Testing", leaseOwner: "build-1", leaseUntil: Date.now() + 600_000 },
    });
    const closed = await completeTask(ctx, {
      taskId: fix.taskId,
      workerId: "build-1",
      outcome: "done",
      note: null,
      latest: { id: "01JA0000000000000000000098", committedAt: 0, createdAt: 0 },
      now: Date.now(),
    });
    expect(closed).toMatchObject({ to: "Done" });
    expect(await props(ctx, fix.defectId)).toMatchObject({ status: "fixed" });
  });

  it("T27: a rejected fix leaves the card in Backlog with the reason, and the defect won't be fixed", async () => {
    const { ctx, codeChangeId } = await deployed();
    await setStage(db, ctx.projectId, "launch", "maintenance");
    const fix = await reportAndFix(ctx, codeChangeId, 3);
    const gate = await gateOf(ctx, fix.gateId);
    const rejected = await rest(ctx.projectId, "POST", `/api/gates/${fix.gateId}/decision`, {
      version: gate.version,
      decision: "reject",
      reason: "Lunch slots are allowed now.",
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body.gate).toMatchObject({
      status: "rejected",
      reason: "Lunch slots are allowed now.",
    });
    expect(rejected.body.opened).toEqual([]);
    expect(await props(ctx, fix.defectId)).toMatchObject({ status: "wont_fix" });
    expect(await boardCard(ctx, "CARD-03")).toMatchObject({
      column: "Backlog",
      note: "Fix rejected: Lunch slots are allowed now.",
      gate: { status: "rejected" },
    });
  });

  it("one Defect per bug report, and propose_fix takes only the item's own report's Defect", async () => {
    const { ctx, codeChangeId } = await deployed();
    await setStage(db, ctx.projectId, "launch", "maintenance");
    const first = await reportAndFix(ctx, codeChangeId, 2);
    // A retried item reports the same bug again: the Defect already written comes back.
    const again = await call(first.maintenance, "report_defect", {
      itemId: first.workItemId,
      title: "t",
      severity: "low",
      codeChangeId,
      reportEpisodeId: first.episodeId,
      reasoning: "r",
    });
    expect(again.out).toEqual({ defectId: first.defectId });

    const report = await rest(ctx.projectId, "POST", `/api/projects/${ctx.projectId}/bug-reports`, {
      text: "Another bug.",
    });
    const { workItemId } = report.body as { workItemId: string };
    const other = await session(ctx.projectId, "maintenance", "maintenance-9");
    await call(other, "claim_item", { kinds: ["maintenance"] });
    const foreign = await call(other, "propose_fix", {
      itemId: workItemId,
      defectId: first.defectId,
      card: fixCard(3),
    });
    expect(foreign.error).toMatchObject({ guard: "source" });
  });

  it("startup repairs read from the graph: C3's Rework cards and T26's approved fix cards", async () => {
    const { ctx, card, codeChangeId, factId } = await deployed();
    await setStage(db, ctx.projectId, "launch", "maintenance");

    // C3: a change request sent CARD-01 to Rework and its replan is done (FalkorDB gotcha 10).
    const { changeRequest } = await createChangeRequest(ctx, {
      text: "Lunch is now 12:30 to 13:30.",
      createdBy: "human:lead",
      now: Date.now(),
    });
    await flagImpact(ctx, { crId: changeRequest.id, factIds: [factId] });
    const replan = await openItem(ctx, {
      kind: "replan",
      subjectId: changeRequest.id,
      createdBy: "proposal",
      now: Date.now(),
    });
    await writeVersioned(ctx, { id: replan!.id, version: 1, props: { status: "done" } });
    const crs = (await readStageState(db, ctx.projectId, ctx.graph))!.changeRequests;
    expect(crs).toEqual([
      expect.objectContaining({ id: changeRequest.id, replanDone: true, reworkTasks: [card] }),
    ]);

    // T26: G6 approved without its stage event (a crash in between).
    const fix = await reportAndFix(ctx, codeChangeId, 2);
    const gate = await props(ctx, fix.gateId);
    await writeVersioned(ctx, {
      id: fix.gateId,
      version: Number(gate.version),
      props: { status: "approved", decidedBy: "human:lead", decidedAt: Date.now() },
    });
    expect((await readStageState(db, ctx.projectId, ctx.graph))!.approvedFixes).toEqual([
      { taskId: fix.taskId, createdBy: "human:lead" },
    ]);
    await openItem(ctx, {
      kind: "write_tests",
      subjectId: fix.taskId,
      createdBy: "human:lead",
      now: Date.now() + 1,
    });
    expect((await readStageState(db, ctx.projectId, ctx.graph))!.approvedFixes).toEqual([]);
  });
});
