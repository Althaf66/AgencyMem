// Work items: open, claim, renew, complete, expire and hand off. Each function is one Cypher query,
// so a claim or a lease check and its change cannot split.
import {
  Id,
  Task,
  WorkItem,
  text,
  type Actor,
  type AgentId,
  type Column,
  type ReadinessCheck,
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

/**
 * Opens a WorkItem, with `note` as its input when given (a G2 rejection reason). Null when an open or
 * claimed item of the same kind and subject exists.
 */
export async function openItem(
  ctx: Ctx,
  input: {
    kind: WorkItemKind;
    subjectId?: string | null;
    note?: string | null;
    createdBy: Actor;
    now: number;
  },
): Promise<WorkItem | null> {
  const rows = await writeQuery<NodeRow>(ctx.db, ctx.graph, "write/open-item", {
    id: ulid(),
    projectId: ctx.projectId,
    kind: input.kind,
    subjectId: Id.nullable().parse(input.subjectId ?? null), // checked before it is written
    note: text(2000)
      .nullable()
      .parse(input.note ?? null),
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

/**
 * Claims a build card (the first free one, or `taskId`) and starts a lease for `workerId`; the card
 * moves to In progress. `from` is its column before. Null means nothing to claim; with `taskId` the
 * gateway reads the card to say why.
 */
export async function claimTask(
  ctx: Ctx,
  input: { taskId?: string; workerId: string; now: number; leaseMs: number },
): Promise<{ task: Task; from: Column } | null> {
  const rows = await writeQuery<{ t: { properties: Record<string, unknown> }; fromColumn: Column }>(
    ctx.db,
    ctx.graph,
    "write/claim-task",
    {
      projectId: ctx.projectId,
      taskId: input.taskId ?? null,
      workerId: input.workerId,
      now: input.now,
      leaseMs: input.leaseMs,
    },
  );
  const row = rows[0];
  return row ? { task: Task.parse(row.t.properties), from: row.fromColumn } : null;
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
    summary?: string;
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
    summary: input.summary ?? null,
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

/**
 * Sets the handoff summary and output ids on a WorkItem. With `report` (launch only, C8), also
 * writes a ReadinessReport: `checks` as a JSON string (C10), `passed` when every check passed.
 * Null when the project has no such item.
 */
export async function writeHandoff(
  ctx: Ctx,
  input: {
    itemId: string;
    summary: string;
    outputIds: string[];
    report?: { checks: ReadinessCheck[] };
    createdBy: Actor;
    now: number;
  },
): Promise<{ item: WorkItem; reportId: string | null } | null> {
  const report = input.report
    ? {
        id: ulid(),
        passed: input.report.checks.every((c) => c.passed),
        checks: JSON.stringify(input.report.checks),
      }
    : null;
  const rows = await writeQuery<NodeRow>(ctx.db, ctx.graph, "write/write-handoff", {
    projectId: ctx.projectId,
    itemId: input.itemId,
    summary: input.summary,
    outputIds: input.outputIds,
    report,
    createdBy: input.createdBy,
    now: input.now,
  });
  const item = toItem(rows[0]);
  return item ? { item, reportId: report?.id ?? null } : null;
}

/**
 * Ends a build run on a card: `done` to Done with a merge item (T19), `failed` to Ready with
 * attempts + 1 and `note`. Null when the caller's lease is gone, or (done) a build commit newer
 * than `latest` arrived after the evidence check.
 */
export async function completeTask(
  ctx: Ctx,
  input: {
    taskId: string;
    workerId: string;
    outcome: "done" | "failed";
    note: string | null;
    /** The build commit the evidence guard checked (done only). */
    latest: { id: string; committedAt: number; createdAt: number } | null;
    now: number;
  },
): Promise<{
  key: string;
  from: Column;
  to: Column;
  version: number;
  mergeItemId: string | null;
} | null> {
  const rows = await writeQuery<{
    key: string;
    fromColumn: Column;
    toColumn: Column;
    version: number;
    mergeItemId: string | null;
  }>(ctx.db, ctx.graph, "write/complete-task", {
    projectId: ctx.projectId,
    taskId: input.taskId,
    workerId: input.workerId,
    outcome: input.outcome,
    now: input.now,
    latestId: input.latest?.id ?? null,
    latestAt: input.latest?.committedAt ?? null,
    latestCreatedAt: input.latest?.createdAt ?? null,
    note: input.note === null ? null : input.note.slice(0, 500), // Task.note is at most 500
    itemId: ulid(),
    createdBy: "build",
  });
  const row = rows[0];
  return row
    ? {
        key: row.key,
        from: row.fromColumn,
        to: row.toColumn,
        version: row.version,
        mergeItemId: row.mergeItemId,
      }
    : null;
}

/** Writes a reason onto the card (an evidence rejection). Returns the new version, or null. */
export async function setTaskNote(
  ctx: Ctx,
  input: { taskId: string; note: string },
): Promise<number | null> {
  const rows = await writeQuery<{ version: number }>(ctx.db, ctx.graph, "write/task-note", {
    projectId: ctx.projectId,
    taskId: input.taskId,
    note: input.note.slice(0, 500),
  });
  return rows[0]?.version ?? null;
}
