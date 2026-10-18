// Task 5.6, Done when: the panel draws from stored metrics, not from the browser. Routes 24 and 25
// return the numbers stored in the graph (rejection counters, Runs, Features with actual hours,
// Lessons), through the real gateway against the real FalkorDB. No mocks.
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgencyMetrics, ProjectMetrics, loadConfig } from "@agencymem/contracts";
import { close, connect, type FalkorDB } from "@agencymem/graph";
import {
  closeProject,
  countRejection,
  createProject,
  deleteTestAgency,
  deleteTestClient,
  setStage,
  writeCaseStudy,
  writeDocument,
  writeFacts,
  writeProduct,
  writeRun,
  type Ctx,
} from "@agencymem/memory";
import { createEvents } from "../events/bus";
import { createGateway } from "../main";

const TOKENS = { AM_AGENT_TOKEN: "agent-t", AM_UI_TOKEN: "ui-t", AM_HOOK_TOKEN: "hook-t" };
const FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";

let db: FalkorDB;
let server: Server;
let base: string;
const graphs = new Set<string>();
const projectIds: string[] = [];

beforeAll(async () => {
  db = await connect(FALKORDB_URL);
  server = createGateway(loadConfig({ ...TOKENS, FALKORDB_URL }, "gateway"), {
    events: createEvents(),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await deleteTestAgency(db, projectIds);
  for (const graph of graphs) await deleteTestClient(db, graph);
  await close();
});

const get = async (path: string) => {
  const res = await fetch(`${base}${path}`, { headers: { "X-AM-Token": "ui-t" } });
  return { status: res.status, body: (await res.json()) as unknown };
};

/** A closed project: FEAT-01 (estimate 5 h, actual 4 h) that used one Lesson, two Runs and three
 * rejections. */
async function closedProject() {
  const now = Date.now();
  const { project, client } = await createProject(db, {
    clientName: `test-client-${randomUUID()}`,
    projectName: "Metrics",
    mode: "demo",
    createdBy: "human:test",
    now,
  });
  const ctx: Ctx = { db, graph: `client_${client.id}`, projectId: project.id };
  graphs.add(ctx.graph);
  projectIds.push(project.id);

  const lesson = await writeCaseStudy(db, {
    // Under this project, so cleanup removes the Lesson; only this file uses the pair.
    projectId: project.id,
    metrics: {
      estimateError: 0,
      questions: 0,
      contradictions: 0,
      changeRequests: 0,
      cardsReopened: 0,
      cards: 0,
      firstPassCards: 0,
      clarityBand: "medium",
    },
    lessonsLearned: "l",
    records: [
      { featureKind: "notification", clarityBand: "medium", estimate: 2, raw: 2, actual: 3 },
    ],
    lessons: [{ featureKind: "notification", clarityBand: "medium", text: "Reminders run long." }],
    createdBy: "curator",
    now,
  });
  const lessonId = lesson!.lessonIds[0]!;

  const { episodeIds } = await writeDocument(ctx, {
    name: "kickoff-notes.pdf",
    mime: "application/pdf",
    sha256: "d".repeat(64),
    status: "processed",
    wordCount: 6,
    error: null,
    episodes: [{ page: 1, lineStart: 1, lineEnd: 1, text: "No slots at lunch." }],
    createdBy: "human:test",
    now,
  });
  const { factIds } = await writeFacts(ctx, {
    entities: [{ key: "clinic", name: "Clinic", aliases: [] }],
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
  const { featureIds } = (await writeProduct(ctx, {
    baseVersion: 0,
    requirements: [{ key: "REQ-01", text: "No slots at lunch.", priority: "must", factIds }],
    features: [
      {
        key: "FEAT-01",
        name: "Reminders",
        featureKind: "notification",
        requirementKeys: ["REQ-01"],
        estimate: { rawHours: 4, hours: 5, basis: "raw 4 h × 1.25", lessonIds: [lessonId] },
      },
    ],
    createdBy: "proposal",
    now,
  }))!;
  await setStage(db, project.id, "intake", "launch");
  await closeProject(ctx, {
    actuals: [{ featureId: featureIds[0]!, actualHours: 4 }],
    overrideReason: null,
    now,
  });

  const run = (tokensIn: number, tokensOut: number, cost: number, model = "m") =>
    writeRun(ctx, {
      itemId: "01JA0000000000000000000001",
      agent: "discovery",
      run: { step: "s", model, endpoint: "primary", tokensIn, tokensOut, ms: 1, cost },
      now,
    });
  await run(100, 20, 0.5);
  await run(300, 40, 0.25);
  // Recorded at cost 0 before the table had its price: the route prices it from the table.
  await run(1_000_000, 1_000_000, 0, "claude-haiku-5-5");
  await countRejection(db, project.id, "rejectedClaims");
  await countRejection(db, project.id, "rejectedClaims");
  await countRejection(db, project.id, "rejectedWrites");
  return { projectId: project.id, lessonId };
}

describe("health metrics (routes 24 and 25)", () => {
  it("returns a project's stored numbers", async () => {
    const { projectId } = await closedProject();
    const { status, body } = await get(`/api/projects/${projectId}/metrics`);
    expect(status).toBe(200);
    expect(ProjectMetrics.parse(body)).toMatchObject({
      estimateError: 0.25, // |5 - 4| / 4
      questions: 0,
      changeRequests: 0,
      cardsReopenedPerCR: null,
      rejected: { claims: 2, writes: 1, completions: 0, queries: 0 },
      coverage: { covered: 0, total: 1 },
      tokensIn: 1_000_400,
      tokensOut: 1_000_060,
    });
    const m = ProjectMetrics.parse(body);
    expect(m.cost).toBeCloseTo(1.35); // 0.75 recorded + 0.10 + 0.50 priced
    expect(m.models).toEqual([
      expect.objectContaining({
        model: "claude-haiku-5-5",
        runs: 1,
        cost: 0.6,
        price: { inPerMillion: 0.1, outPerMillion: 0.5 },
      }),
      expect.objectContaining({ model: "m", runs: 2, tokensIn: 400, cost: 0.75, price: null }),
    ]);
  });

  it("lists every project in run order with the lessons its estimates used", async () => {
    const { projectId, lessonId } = await closedProject();
    const { status, body } = await get("/api/agency/metrics");
    expect(status).toBe(200);
    const agency = AgencyMetrics.parse(body);
    const row = agency.projects.find((p) => p.projectId === projectId);
    expect(row).toMatchObject({
      name: "Metrics",
      estimateError: 0.25,
      lessonsUsed: 1,
      lessons: [{ id: lessonId, featureKind: "notification", clarityBand: "medium" }],
    });
    expect(row!.closedAt).not.toBeNull();
    const orders = agency.projects.map((p) => p.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(agency.lessons.map((l) => l.id)).toContain(lessonId);
  });

  it("answers 404 for an unknown project", async () => {
    expect((await get("/api/projects/01JA0000000000000000000000/metrics")).status).toBe(404);
  });
});
