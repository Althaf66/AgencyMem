// The lease sweeper against the real FalkorDB from docker-compose.yml. No mocks.
import { randomUUID } from "node:crypto";
import { ulid } from "ulid";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Envelope } from "@agencymem/contracts";
import { close, connect, readQuery, type FalkorDB } from "@agencymem/graph";
import {
  claimItem,
  createProject,
  openItem,
  seedBoardForTest,
  writeDocument,
  writeFacts,
  writeProduct,
  type Ctx,
  deleteTestClient,
} from "@agencymem/memory";
import { createEvents } from "./bus";
import { sweepOnce } from "./sweeper";

const FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";
let db: FalkorDB;
let ctx: Ctx;

beforeAll(async () => {
  db = await connect(FALKORDB_URL);
  const { project, client } = await createProject(db, {
    clientName: `test-client-${randomUUID()}`,
    projectName: "Sweeper",
    mode: "demo",
    createdBy: "human:test",
    now: 1,
  });
  ctx = { db, graph: `client_${client.id}`, projectId: project.id };
});
afterAll(async () => {
  await deleteTestClient(db, ctx.graph);
  await close();
});

it("frees a claimed item whose lease ended and sends lease.changed (expire)", async () => {
  const T = Date.now();
  const item = (await openItem(ctx, {
    kind: "intake",
    subjectId: ulid(),
    createdBy: "human:test",
    now: T,
  }))!;
  await claimItem(ctx, {
    kinds: ["intake"],
    itemId: item.id,
    workerId: "intake-1",
    now: T,
    leaseMs: 10,
  });

  const events = createEvents();
  const sent: Envelope[] = [];
  events.on((e) => sent.push(e));
  await sweepOnce({ db, events }, T + 1000);

  const mine = sent.filter((e) => e.projectId === ctx.projectId);
  expect(mine.map((e) => e.type)).toEqual(["lease.changed", "node.written"]);
  expect(mine[0]?.data).toEqual({ itemId: item.id, owner: null, until: null, reason: "expire" });
  expect(mine[1]?.data).toMatchObject({ label: "WorkItem", id: item.id, version: 3 });
});

it("sends a card whose lease ended back to Ready with one more attempt (contracts.md section 10)", async () => {
  const T = Date.now();
  const { episodeIds } = await writeDocument(ctx, {
    name: "notes.pdf",
    mime: "application/pdf",
    sha256: "5".repeat(64),
    status: "processed",
    wordCount: 2,
    error: null,
    episodes: [{ page: 1, lineStart: 1, lineEnd: 1, text: "One rule." }],
    createdBy: "human:test",
    now: T,
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
    now: T,
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
    now: T,
  });
  const card = (
    key: string,
    column: "In progress" | "Testing" | "Ready",
    until: number | null,
  ) => ({
    key,
    requirementKey: "REQ-01",
    uses: null,
    column,
    leaseOwner: until === null ? null : "build-1",
    leaseUntil: until,
  });
  const { tasks } = await seedBoardForTest(ctx, {
    endpoints: [],
    sections: [],
    tasks: [
      card("CARD-01", "In progress", T + 10), // ended at the sweep
      card("CARD-02", "Testing", T + 10), // ended at the sweep
      card("CARD-03", "In progress", T + 600_000), // still live
      card("CARD-04", "Ready", null),
    ],
    createdBy: "human:test",
    now: T,
  });
  const id = (key: string) => tasks.find((t) => t.key === key)!.id;

  const events = createEvents();
  const sent: Envelope[] = [];
  events.on((e) => sent.push(e));
  await sweepOnce({ db, events }, T + 1000);

  const moved = sent.flatMap((e) =>
    e.projectId === ctx.projectId && e.type === "task.moved" ? [e.data] : [],
  );
  expect(moved.sort((a, b) => a.key.localeCompare(b.key))).toEqual([
    { taskId: id("CARD-01"), key: "CARD-01", from: "In progress", to: "Ready", version: 2 },
    { taskId: id("CARD-02"), key: "CARD-02", from: "Testing", to: "Ready", version: 2 },
  ]);
  const expired = sent.flatMap((e) =>
    e.type === "lease.changed" && [id("CARD-01"), id("CARD-02")].includes(e.data.itemId)
      ? [e.data.reason]
      : [],
  );
  expect(expired).toEqual(["expire", "expire"]);
  const [row] = await readQuery<{ n: { properties: Record<string, unknown> } }>(
    db,
    ctx.graph,
    "read/node",
    { id: id("CARD-01") },
  );
  expect(row!.n.properties).toMatchObject({ column: "Ready", attempts: 1, version: 2 });
  expect(row!.n.properties.leaseOwner).toBeUndefined(); // a null property is removed
});

it("leaves alone a project whose client graph does not exist", async () => {
  const { client } = await createProject(db, {
    clientName: `test-client-${randomUUID()}`,
    projectName: "Gone",
    mode: "demo",
    createdBy: "human:test",
    now: 1,
  });
  const gone = `client_${client.id}`;
  await db.selectGraph(gone).delete();
  await sweepOnce({ db, events: createEvents() }, Date.now());
  // A write query on a missing graph would create it; the sweeper must not.
  expect(await db.list()).not.toContain(gone);
  await deleteTestClient(db, gone); // the registry entry; the graph is already gone
});
