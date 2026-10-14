// Runs against the real FalkorDB from docker-compose.yml. No mocks.
import { afterAll, beforeAll, expect, it } from "vitest";
import { ulid } from "ulid";
import { close, connect, type FalkorDB } from "@agencymem/graph";
import { claimItem, openItem, writeVersioned, type Ctx } from "./index";

const URL_ = process.env.FALKORDB_URL ?? "redis://localhost:6380";
const GRAPH = `client_test_versioned_${process.pid}_${Date.now()}`;
let db: FalkorDB;
let ctx: Ctx;

beforeAll(async () => {
  db = await connect(URL_);
  ctx = { db, graph: GRAPH, projectId: ulid() };
});
afterAll(async () => {
  await db.selectGraph(GRAPH).delete();
  await close();
});

it("writes with the current version, rejects an old one, and removes a property set to null", async () => {
  const item = (await openItem(ctx, { kind: "intake", createdBy: "human:test", now: 1 }))!;
  expect(item.version).toBe(1);

  expect(await writeVersioned(ctx, { id: item.id, version: 1, props: { note: "kept" } })).toBe(2);
  // An old version changes nothing (no row back).
  expect(
    await writeVersioned(ctx, { id: item.id, version: 1, props: { note: "stale" } }),
  ).toBeNull();
  expect(await writeVersioned(ctx, { id: item.id, version: 2, props: { handoff: "h" } })).toBe(3);
  // C10: null removes the property.
  expect(await writeVersioned(ctx, { id: item.id, version: 3, props: { handoff: null } })).toBe(4);
  // An unknown id is the same as an old version: no row.
  expect(await writeVersioned(ctx, { id: ulid(), version: 1, props: { note: "x" } })).toBeNull();

  // Read the node back (a claim returns it): the stale write did nothing, handoff is gone.
  const stored = await claimItem(ctx, {
    kinds: ["intake"],
    workerId: "intake-1",
    now: 2,
    leaseMs: 10,
  });
  expect(stored).toMatchObject({ id: item.id, note: "kept", handoff: null, version: 5 });
});
