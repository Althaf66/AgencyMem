// The lease sweeper against the real FalkorDB from docker-compose.yml. No mocks.
import { randomUUID } from "node:crypto";
import { ulid } from "ulid";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Envelope } from "@agencymem/contracts";
import { close, connect, type FalkorDB } from "@agencymem/graph";
import { claimItem, createProject, openItem, type Ctx } from "@agencymem/memory";
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
  await db.selectGraph(ctx.graph).delete();
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
});
