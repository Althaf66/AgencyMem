// Task 5.4, Done when: no lesson text contains a client entity name, email or URL. The close route
// (route 29, T28), the Curator's recall and write_case_study with the anonymity guard, and T29,
// through the real gateway against the real FalkorDB from docker-compose.yml. No mocks.
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type CaseMetrics } from "@agencymem/contracts";
import {
  AGENCY_GRAPH,
  REGISTRY_GRAPH,
  close,
  connect,
  readQuery,
  type FalkorDB,
} from "@agencymem/graph";
import {
  createGates,
  createProject,
  deleteTestAgency,
  deleteTestClient,
  openItem,
  setStage,
  writeCards,
  writeDocument,
  writeFacts,
  writeProduct,
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
const projectIds: string[] = [];
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
  await deleteTestAgency(db, projectIds);
  for (const graph of graphs) await deleteTestClient(db, graph);
  await close();
});

const props = async (graph: string, id: string) =>
  (
    await readQuery<{ n: { properties: Record<string, unknown> } }>(db, graph, "read/node", { id })
  )[0]!.n.properties;

async function rest(projectId: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "X-AM-Token": "ui-t",
      "X-AM-Actor": "human:lead",
      "X-AM-Project": projectId,
      "Content-Type": "application/json",
    },
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

let shas = 0;
const nextSha = () => (++shas).toString(16).padStart(40, "e");

/**
 * A project in launch: the client "Sunrise Dental" (alias SDG) as an Entity, REQ-01 and FEAT-01
 * (calendar, raw 4 h, estimate 5 h), and CARD-01 Done with one linked build commit. With `report`,
 * the Launch agent has also written a passing readiness report.
 */
async function inLaunch(report = true) {
  const now = Date.now();
  const { project, client } = await createProject(db, {
    clientName: `test-client-${randomUUID()}`,
    projectName: "Close",
    mode: "demo",
    createdBy: "human:test",
    now,
  });
  const ctx: Ctx = { db, graph: `client_${client.id}`, projectId: project.id };
  graphs.add(ctx.graph);
  projectIds.push(project.id);
  await setStage(db, project.id, "intake", "launch");
  await createGates(ctx, { keys: ["G1", "G2", "G3"], createdBy: "human:test", now });
  const { episodeIds } = await writeDocument(ctx, {
    name: "kickoff-notes.pdf",
    mime: "application/pdf",
    sha256: "c".repeat(64),
    status: "processed",
    wordCount: 9,
    error: null,
    episodes: [{ page: 1, lineStart: 1, lineEnd: 1, text: "Sunrise Dental: no slots at lunch." }],
    createdBy: "human:test",
    now,
  });
  const { factIds } = await writeFacts(ctx, {
    entities: [{ key: "clinic", name: "Sunrise Dental", aliases: ["SDG"] }],
    facts: [
      {
        statement: "There are no slots at lunch.",
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
    requirements: [{ key: "REQ-01", text: "No slots at lunch.", priority: "must", factIds }],
    features: [
      {
        key: "FEAT-01",
        name: "Slot calendar",
        featureKind: "calendar",
        requirementKeys: ["REQ-01"],
        estimate: { rawHours: 4, hours: 5, basis: "raw 4 h × 1.25 = 5 h", lessonIds: [] },
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
  await writeVersioned(ctx, {
    id: card,
    version: Number((await props(ctx.graph, card)).version),
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
  const [feature] = await readQuery<{ id: string }>(db, ctx.graph, "read/features", {
    projectId: project.id,
  });
  if (report) await readinessReport(ctx);
  return { ctx, card, codeChangeId, featureId: feature!.id };
}

/** The Launch agent's run, with every check passing. */
async function readinessReport(ctx: Ctx) {
  const item = await openItem(ctx, { kind: "launch", createdBy: "test", now: Date.now() });
  const launch = await session(ctx.projectId, "launch", "launch-1");
  await call(launch, "claim_item", { itemId: item!.id, kinds: ["launch"] });
  const checks = (["cards_done", "coverage", "open_assumptions", "drift"] as const).map((name) => ({
    name,
    passed: true,
    detail: "none",
    nodeIds: [],
  }));
  await call(launch, "write_handoff", {
    itemId: item!.id,
    summary: "Readiness",
    outputIds: [],
    report: { checks },
  });
  await call(launch, "complete_item", {
    itemId: item!.id,
    outcome: "done",
    summary: "Readiness",
    runs: [],
  });
}

const closeRoute = (projectId: string, actuals: { featureId: string; actualHours: number }[]) =>
  rest(projectId, "POST", `/api/projects/${projectId}/close`, { actuals });

const stage = async (projectId: string) =>
  (
    await readQuery<{ p: { properties: Record<string, unknown> } }>(
      db,
      REGISTRY_GRAPH,
      "read/project",
      { projectId },
    )
  )[0]!.p.properties;

const lesson = async (featureKind: string, clarityBand: string) =>
  (
    await readQuery<{ ratio: number; n: number; text: string; projectIds: string[] }>(
      db,
      AGENCY_GRAPH,
      "read/similar-lessons",
      { featureKinds: [featureKind] },
    )
  ).find((l) => (l as unknown as { clarityBand: string }).clarityBand === clarityBand);

/** Closes the project with FEAT-01 at `actual` hours and claims its curator item. */
async function closed(actual: number) {
  const setup = await inLaunch();
  const res = await closeRoute(setup.ctx.projectId, [
    { featureId: setup.featureId, actualHours: actual },
  ]);
  expect(res.status).toBe(200);
  const workItemId = res.body.workItemId as string;
  const curator = await session(setup.ctx.projectId, "curator", "curator-1");
  await call(curator, "claim_item", { itemId: workItemId, kinds: ["curator"] });
  return { ...setup, curator, workItemId, res };
}

const caseStudy = (itemId: string, metrics: CaseMetrics, lessonText: string, actual: number) => ({
  itemId,
  caseStudy: { metrics, lessonsLearned: "Questions on the lunch break saved rework." },
  records: [{ featureKind: "calendar", clarityBand: "low", estimate: 5, raw: 4, actual }],
  lessons: [{ featureKind: "calendar", clarityBand: "low", text: lessonText }],
});

describe("closing a project (route 29, T28)", () => {
  it("refuses outside launch, before the readiness report, and with actuals that miss a feature", async () => {
    const { ctx, featureId } = await inLaunch(false);
    await setStage(db, ctx.projectId, "launch", "e2e");
    expect((await closeRoute(ctx.projectId, [{ featureId, actualHours: 6 }])).status).toBe(409);
    await setStage(db, ctx.projectId, "e2e", "launch");

    const early = await closeRoute(ctx.projectId, [{ featureId, actualHours: 6 }]);
    expect(early.status).toBe(409);
    expect(early.body.error).toMatchObject({
      guard: "gate",
      reason: "There is no readiness report yet.",
    });

    await readinessReport(ctx);
    expect((await closeRoute(ctx.projectId, [])).status).toBe(400);
    expect(
      (
        await closeRoute(ctx.projectId, [
          { featureId, actualHours: 6 },
          { featureId, actualHours: 6 },
        ])
      ).status,
    ).toBe(400);
    expect((await closeRoute(ctx.projectId, [{ featureId, actualHours: 6 }])).status).toBe(200);
  });

  it("stores the actual hours and closedAt, moves to case_study and opens the curator item", async () => {
    const { ctx, featureId, res } = await closed(6);
    expect(res.body.project).toMatchObject({ stage: "case_study" });
    expect((res.body.project as { closedAt: number }).closedAt).toBeGreaterThan(0);
    expect(await props(ctx.graph, featureId)).toMatchObject({ actualHours: 6 });
    expect(await props(ctx.graph, res.body.workItemId as string)).toMatchObject({
      kind: "curator",
      status: "claimed",
    });
    // A second close is refused: the project is no longer in launch.
    expect((await closeRoute(ctx.projectId, [{ featureId, actualHours: 7 }])).status).toBe(409);
  });
});

describe("the Curator's case study (task 5.4)", () => {
  it("recalls the metrics (an H4 reopen counts), the features with actual hours and the entities", async () => {
    const { ctx, card, featureId } = await inLaunch();
    const { version } = await props(ctx.graph, card);
    const reopened = await rest(ctx.projectId, "PATCH", `/api/tasks/${card}`, {
      version,
      column: "Rework",
    });
    expect(reopened.status).toBe(200);
    expect(await props(ctx.graph, card)).toMatchObject({ reopened: 1 });
    // T30 sent the project back to build; the reopen still counts once it is in launch again.
    expect(await stage(ctx.projectId)).toMatchObject({ stage: "build" });
    await setStage(db, ctx.projectId, "build", "launch");

    const res = await closeRoute(ctx.projectId, [{ featureId, actualHours: 6 }]);
    const workItemId = res.body.workItemId as string;
    const curator = await session(ctx.projectId, "curator", "curator-1");
    await call(curator, "claim_item", { itemId: workItemId, kinds: ["curator"] });
    const { out } = await call(curator, "recall_context", { itemId: workItemId });
    const context = (out as { context: Record<string, unknown> }).context;
    expect(context.metrics).toEqual({
      estimateError: 1 / 6, // |5 − 6| ÷ 6
      questions: 0,
      contradictions: 0,
      changeRequests: 0,
      cardsReopened: 1,
      cards: 1,
      firstPassCards: 0, // its commit has no test run
      clarityBand: "high",
    });
    expect(context.features).toEqual([expect.objectContaining({ key: "FEAT-01", actualHours: 6 })]);
    expect(context.entities).toEqual([
      expect.objectContaining({ name: "Sunrise Dental", aliases: ["SDG"] }),
    ]);
  });

  it("Done when: refuses a lesson with a client name or an email, and writes a clean one", async () => {
    const { ctx, curator, workItemId } = await closed(6);
    const { out } = await call(curator, "recall_context", { itemId: workItemId });
    const metrics = (out as { context: { metrics: CaseMetrics } }).context.metrics;

    const named = await call(
      curator,
      "write_case_study",
      caseStudy(workItemId, metrics, "Calendars at sdg ran over.", 6),
    );
    expect(named.error).toMatchObject({
      guard: "anonymity",
      details: { reasonCode: "NAME_FOUND", match: "SDG" },
    });
    const mailed = await call(
      curator,
      "write_case_study",
      caseStudy(workItemId, metrics, "Ask ops@clinic.example early.", 6),
    );
    expect(mailed.error).toMatchObject({ details: { reasonCode: "EMAIL_FOUND" } });
    const linked = await call(
      curator,
      "write_case_study",
      caseStudy(workItemId, metrics, "See https://notes.example/lunch first.", 6),
    );
    expect(linked.error).toMatchObject({ details: { reasonCode: "URL_FOUND" } });
    expect(await stage(ctx.projectId)).toMatchObject({ rejectedWrites: 3 });

    const clean = caseStudy(workItemId, metrics, "Calendars ran 50% over: hidden rules.", 6);
    const written = await call(curator, "write_case_study", clean);
    const ids = written.out as { caseStudyId: string; recordIds: string[]; lessonIds: string[] };
    expect(ids.recordIds).toHaveLength(1);
    expect(ids.lessonIds).toHaveLength(1);
    expect(await lesson("calendar", "low")).toMatchObject({
      ratio: 1.5, // actual 6 ÷ raw 4
      n: 1,
      text: "Calendars ran 50% over: hidden rules.",
      projectIds: [ctx.projectId],
    });
    // One case study per project: a retry gets the same ids and writes nothing.
    expect((await call(curator, "write_case_study", clean)).out).toEqual(ids);
    expect(await lesson("calendar", "low")).toMatchObject({ n: 1 });

    // T29: the curator item done closes the project.
    await call(curator, "complete_item", { itemId: workItemId, outcome: "done", runs: [] });
    expect(await stage(ctx.projectId)).toMatchObject({ stage: "closed" });

    // A second project's record of the same pair: n = 2, ratio = the mean of 1.5 and 0.5.
    const second = await closed(2);
    await call(
      second.curator,
      "write_case_study",
      caseStudy(second.workItemId, metrics, "Calendars ran under: simple rules.", 2),
    );
    expect(await lesson("calendar", "low")).toMatchObject({
      ratio: 1,
      n: 2,
      text: "Calendars ran under: simple rules.",
      projectIds: [ctx.projectId, second.ctx.projectId],
    });
  });
});
