// Runs against the real FalkorDB from docker-compose.yml. No mocks.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FalkorDB } from "falkordb";
import { ulid } from "ulid";
import type { RunInput } from "@agencymem/contracts";
import { readQuery } from "@agencymem/graph";
import { cancelItems, claimItem, complete, expireLeases, openItem, renew, type Ctx } from "./index";

const URL_ = process.env.FALKORDB_URL ?? "redis://localhost:6380";
const GRAPH = `client_test_workboard_${process.pid}_${Date.now()}`;
const LEASE = 600_000;
const T0 = 1_760_000_000_000;
const WORKERS = 10;

/** One FalkorDB connection per worker, so the claims really race. */
let clients: FalkorDB[] = [];
let ctx: Ctx;

beforeAll(async () => {
  clients = await Promise.all(
    Array.from({ length: WORKERS }, () => FalkorDB.connect({ url: URL_ })),
  );
  ctx = { db: clients[0]!, graph: GRAPH, projectId: ulid() };
});
afterAll(async () => {
  await clients[0]?.selectGraph(GRAPH).delete();
  await Promise.all(clients.map((c) => c.close()));
});

const open = (kind: "intake" | "discovery" = "intake", subjectId: string | null = ulid()) =>
  openItem(ctx, { kind, subjectId, createdBy: "human:test", now: T0 });

const run: RunInput = {
  step: "think",
  model: "thin",
  endpoint: "primary",
  tokensIn: 100,
  tokensOut: 20,
  ms: 900,
  cost: 0.002,
};

describe("claimItem (Done when: two parallel claims on one item, exactly one wins)", () => {
  it("lets exactly one of 10 racing workers claim the only open item, every round", async () => {
    for (let round = 0; round < 5; round++) {
      const project = { ...ctx, projectId: ulid() };
      const item = await openItem(project, {
        kind: "intake",
        subjectId: ulid(),
        createdBy: "human:test",
        now: T0,
      });
      expect(item).not.toBeNull();

      const results = await Promise.all(
        clients.map((db, i) =>
          claimItem(
            { ...project, db },
            { kinds: ["intake"], workerId: `intake-${i}`, now: T0, leaseMs: LEASE },
          ),
        ),
      );
      const winners = results.filter((r) => r !== null);
      expect(winners).toHaveLength(1);
      expect(winners[0]).toMatchObject({
        id: item!.id,
        status: "claimed",
        leaseUntil: T0 + LEASE,
        version: 2,
      });
      const winnerIndex = results.findIndex((r) => r !== null);
      expect(winners[0]!.leaseOwner).toBe(`intake-${winnerIndex}`);
    }
  });

  it("lets exactly one worker take a named item; the rest get null (LEASE_HELD)", async () => {
    const item = await open();
    const results = await Promise.all(
      clients.map((db, i) =>
        claimItem(
          { ...ctx, db },
          { kinds: ["intake"], itemId: item!.id, workerId: `w-${i}`, now: T0, leaseMs: LEASE },
        ),
      ),
    );
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it("takes the oldest open item of the given kinds and skips other kinds", async () => {
    const project = { ...ctx, projectId: ulid() };
    const first = await openItem(project, { kind: "discovery", createdBy: "human:test", now: T0 });
    await openItem(project, {
      kind: "discovery",
      subjectId: ulid(),
      createdBy: "human:test",
      now: T0 + 1,
    });
    await openItem(project, {
      kind: "intake",
      subjectId: ulid(),
      createdBy: "human:test",
      now: T0 - 5,
    });
    const claimed = await claimItem(project, {
      kinds: ["discovery"],
      workerId: "discovery-1",
      now: T0 + 10,
      leaseMs: LEASE,
    });
    expect(claimed?.id).toBe(first!.id);
  });

  it("does not take an item from another project", async () => {
    await open();
    const other = await claimItem(
      { ...ctx, projectId: ulid() },
      { kinds: ["intake"], workerId: "intake-x", now: T0, leaseMs: LEASE },
    );
    expect(other).toBeNull();
  });
});

describe("openItem", () => {
  it("opens one item per kind and subject while one is open or claimed", async () => {
    const subjectId = ulid();
    expect(await open("intake", subjectId)).not.toBeNull();
    expect(await open("intake", subjectId)).toBeNull();
  });

  it("refuses a subjectId that is not an id, before writing anything", async () => {
    const project = { ...ctx, projectId: ulid() };
    await expect(
      openItem(project, {
        kind: "intake",
        subjectId: "not-an-id",
        createdBy: "human:test",
        now: T0,
      }),
    ).rejects.toThrow();
    const none = await claimItem(project, {
      kinds: ["intake"],
      workerId: "intake-1",
      now: T0,
      leaseMs: LEASE,
    });
    expect(none).toBeNull(); // nothing was written
  });
});

describe("renew", () => {
  it("renews the owner's live lease and says why it refuses the others", async () => {
    const project = { ...ctx, projectId: ulid() };
    await openItem(project, { kind: "intake", createdBy: "human:test", now: T0 });
    const item = await claimItem(project, {
      kinds: ["intake"],
      workerId: "intake-1",
      now: T0,
      leaseMs: LEASE,
    });

    const later = T0 + 60_000;
    expect(
      await renew(project, { id: item!.id, workerId: "intake-1", now: later, leaseMs: LEASE }),
    ).toEqual({
      ok: true,
      leaseUntil: later + LEASE,
    });
    expect(
      await renew(project, { id: item!.id, workerId: "intake-2", now: later, leaseMs: LEASE }),
    ).toEqual({
      ok: false,
      owner: "intake-1",
      until: later + LEASE,
    });
    const tooLate = later + LEASE + 1;
    expect(
      await renew(project, { id: item!.id, workerId: "intake-1", now: tooLate, leaseMs: LEASE }),
    ).toEqual({
      ok: false,
      owner: "intake-1",
      until: later + LEASE,
    });
  });
});

describe("complete", () => {
  async function claimed(workerId = "intake-1") {
    const project = { ...ctx, projectId: ulid() };
    await openItem(project, { kind: "intake", createdBy: "human:test", now: T0 });
    const item = await claimItem(project, { kinds: ["intake"], workerId, now: T0, leaseMs: LEASE });
    return { project, item: item! };
  }

  it("marks the item done, clears the lease and records one Run per entry", async () => {
    const { project, item } = await claimed();
    const done = await complete(project, {
      itemId: item.id,
      workerId: "intake-1",
      agent: "intake",
      outcome: "done",
      runs: [run, { ...run, step: "act" }],
      now: T0 + 5,
    });
    expect(done).toMatchObject({
      status: "done",
      doneAt: T0 + 5,
      leaseOwner: null,
      leaseUntil: null,
      attempts: 0,
      version: 3,
    });
    const runs = await readQuery<{ step: string; agent: string; cost: number }>(
      project.db,
      GRAPH,
      "read/item-runs",
      { itemId: item.id },
    );
    expect(runs.map(({ step, agent }) => ({ step, agent }))).toEqual([
      { step: "act", agent: "intake" },
      { step: "think", agent: "intake" },
    ]);
  });

  it("refuses a worker that does not hold the lease", async () => {
    const { project, item } = await claimed();
    const result = await complete(project, {
      itemId: item.id,
      workerId: "intake-9",
      agent: "intake",
      outcome: "done",
      runs: [],
      now: T0 + 5,
    });
    expect(result).toBeNull();
  });

  it("sends a failed item back to open with one more attempt, and blocks it at 3; the first note stays", async () => {
    const { project, item } = await claimed();
    let current = item;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const failed = await complete(project, {
        itemId: current.id,
        workerId: "intake-1",
        agent: "intake",
        outcome: "failed",
        note: `attempt ${attempt} failed`,
        runs: [run],
        now: T0 + attempt,
      });
      expect(failed).toMatchObject({
        attempts: attempt,
        status: attempt < 3 ? "open" : "blocked",
        note: "attempt 1 failed", // a later note never replaces the first (an opening note is input)
        leaseOwner: null,
        doneAt: null,
      });
      if (attempt < 3) {
        current = (await claimItem(project, {
          kinds: ["intake"],
          workerId: "intake-1",
          now: T0 + attempt,
          leaseMs: LEASE,
        }))!;
        expect(current).not.toBeNull();
      }
    }
    expect(
      await claimItem(project, {
        kinds: ["intake"],
        workerId: "intake-1",
        now: T0 + 9,
        leaseMs: LEASE,
      }),
    ).toBeNull();
  });
});

describe("expireLeases", () => {
  it("returns a claimed item whose lease ended to open, with one more attempt", async () => {
    const project = { ...ctx, projectId: ulid() };
    await openItem(project, { kind: "intake", createdBy: "human:test", now: T0 });
    const item = await claimItem(project, {
      kinds: ["intake"],
      workerId: "intake-1",
      now: T0,
      leaseMs: LEASE,
    });

    expect(await expireLeases(project, { now: T0 + LEASE - 1 })).toEqual([]);
    const expired = await expireLeases(project, { now: T0 + LEASE + 1 });
    expect(expired).toHaveLength(1);
    expect(expired[0]).toMatchObject({
      id: item!.id,
      status: "open",
      attempts: 1,
      leaseOwner: null,
      leaseUntil: null,
    });
    const again = await claimItem(project, {
      kinds: ["intake"],
      workerId: "intake-2",
      now: T0 + LEASE + 2,
      leaseMs: LEASE,
    });
    expect(again?.leaseOwner).toBe("intake-2");
  });
});

describe("cancelItems (T30)", () => {
  it("cancels the open and claimed items of the kinds, clears the lease, and leaves the rest", async () => {
    const project = { ...ctx, projectId: ulid() };
    const item = (kind: "e2e" | "launch" | "merge") =>
      openItem(project, { kind, subjectId: null, createdBy: "human:test", now: T0 });
    const e2e = await item("e2e");
    const launch = await item("launch");
    const merge = await item("merge");
    await claimItem(project, { kinds: ["e2e"], workerId: "test-e2e-1", now: T0, leaseMs: LEASE });

    const cancelled = await cancelItems(project, { kinds: ["e2e", "launch"] });
    expect(cancelled.map((c) => [c.item.id, c.claimed]).sort()).toEqual(
      [
        [e2e!.id, true],
        [launch!.id, false],
      ].sort(),
    );
    const claimedOne = cancelled.find((c) => c.claimed)!.item;
    expect(claimedOne).toMatchObject({
      status: "cancelled",
      leaseOwner: null,
      leaseUntil: null,
      version: 3,
    });
    expect(await cancelItems(project, { kinds: ["e2e", "launch"] })).toEqual([]); // idempotent
    const [left] = await readQuery<{ n: { properties: Record<string, unknown> } }>(
      ctx.db,
      GRAPH,
      "read/node",
      { id: merge!.id },
    );
    expect(left!.n.properties).toMatchObject({ status: "open" });
  });
});
