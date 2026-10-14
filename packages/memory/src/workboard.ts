// Work items: open, claim, renew, complete and expire. Each function is one Cypher query, so a
// claim or a lease check and its change cannot split.
import {
  WorkItem,
  type Actor,
  type AgentId,
  type RunInput,
  type WorkItemKind,
} from "@agencymem/contracts";
import { writeQuery } from "@agencymem/graph/write";
import { ulid } from "ulid";
import type { Ctx } from "./ctx";
import { runRows } from "./runs";

type NodeRow = { w: { properties: Record<string, unknown> } };

const toItem = (row: NodeRow | undefined): WorkItem | null =>
  row ? WorkItem.parse(row.w.properties) : null;

/** Opens a WorkItem. Null when an open or claimed item of the same kind and subject exists. */
export async function openItem(
  ctx: Ctx,
  input: { kind: WorkItemKind; subjectId?: string | null; createdBy: Actor; now: number },
): Promise<WorkItem | null> {
  const rows = await writeQuery<NodeRow>(ctx.db, ctx.graph, "write/open-item", {
    id: ulid(),
    projectId: ctx.projectId,
    kind: input.kind,
    subjectId: input.subjectId ?? null,
    createdBy: input.createdBy,
    now: input.now,
  });
  return toItem(rows[0]);
}

/**
 * Claims the oldest open item of `kinds` (or the item `itemId`) and starts a lease for `workerId`.
 * Null means nothing to claim; with `itemId` the gateway reports that as LEASE_HELD.
 */
export async function claimItem(
  ctx: Ctx,
  input: {
    kinds: WorkItemKind[];
    itemId?: string;
    workerId: string;
    now: number;
    leaseMs: number;
  },
): Promise<WorkItem | null> {
  const rows = await writeQuery<NodeRow>(ctx.db, ctx.graph, "write/claim-item", {
    projectId: ctx.projectId,
    kinds: input.kinds,
    itemId: input.itemId ?? null,
    workerId: input.workerId,
    now: input.now,
    leaseMs: input.leaseMs,
  });
  return toItem(rows[0]);
}

export type RenewResult =
  { ok: true; leaseUntil: number } | { ok: false; owner: string | null; until: number | null };

/**
 * Renews the lease on a WorkItem or a Task. When it refuses, `owner` and `until` tell the lease
 * guard why: another worker (LEASE_OTHER_WORKER) or an ended lease (LEASE_ENDED).
 */
export async function renew(
  ctx: Ctx,
  input: { id: string; workerId: string; now: number; leaseMs: number },
): Promise<RenewResult> {
  const rows = await writeQuery<{ ok: boolean; owner: string | null; until: number | null }>(
    ctx.db,
    ctx.graph,
    "write/renew-lease",
    { projectId: ctx.projectId, ...input },
  );
  const row = rows[0];
  if (!row) return { ok: false, owner: null, until: null };
  if (row.ok && row.until !== null) return { ok: true, leaseUntil: row.until };
  return { ok: false, owner: row.owner ?? null, until: row.until ?? null };
}

/**
 * Completes an item whose live lease `workerId` holds, and records one Run per `runs` entry.
 * Null when the caller holds no live lease on it.
 */
export async function complete(
  ctx: Ctx,
  input: {
    itemId: string;
    workerId: string;
    agent: AgentId;
    outcome: "done" | "failed";
    note?: string;
    runs: RunInput[];
    now: number;
  },
): Promise<WorkItem | null> {
  const rows = await writeQuery<NodeRow>(ctx.db, ctx.graph, "write/complete-item", {
    projectId: ctx.projectId,
    itemId: input.itemId,
    workerId: input.workerId,
    outcome: input.outcome,
    note: input.note ?? null,
    now: input.now,
    runs: runRows(input.runs, {
      projectId: ctx.projectId,
      itemId: input.itemId,
      agent: input.agent,
      now: input.now,
    }),
  });
  return toItem(rows[0]);
}

/** Frees the project's claimed items whose lease ended. Returns the items it changed. */
export async function expireLeases(ctx: Ctx, input: { now: number }): Promise<WorkItem[]> {
  const rows = await writeQuery<NodeRow>(ctx.db, ctx.graph, "write/expire-item-leases", {
    projectId: ctx.projectId,
    now: input.now,
  });
  return rows.map((row) => WorkItem.parse(row.w.properties));
}
