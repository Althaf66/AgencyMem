import type { ToolInput, ToolOutput } from "@agencymem/contracts";
import { readQuery } from "@agencymem/graph";
import { completeTask, setTaskNote } from "@agencymem/memory";
import { evidence, lease, version as versionGuard, type GuardResult } from "../guards";
import {
  agentOf,
  findOwn,
  guardFail,
  invalid,
  memoryCtx,
  num,
  ok,
  str,
  type Outcome,
  type ToolCtx,
} from "./common";

type EvidenceRow = {
  commits: { id: string; sha: string; committedAt: number; createdAt: number }[];
  cases: { id: string; key: string; runs: { sha: string; passed: boolean; ranAt: number }[] }[];
  pending: string[];
};

/** The evidence guard's facts for the card's latest build commit, from evidence.cypher. */
async function evidenceOf(ctx: ToolCtx, taskId: string) {
  const [row] = await readQuery<EvidenceRow>(ctx.db, ctx.binding.graph, "read/evidence", {
    projectId: ctx.binding.projectId,
    taskId,
  });
  // committedAt is whole seconds (the hook's %ct): ties go by when the gateway recorded the commit,
  // then by id, the same order complete-task.cypher uses for "newer".
  const latest = [...(row?.commits ?? [])]
    .sort(
      (a, b) =>
        a.committedAt - b.committedAt ||
        a.createdAt - b.createdAt ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .at(-1);
  const cases = row?.cases ?? [];
  // A case passes when its newest run at the latest commit passed.
  const passes = (c: EvidenceRow["cases"][number]) =>
    c.runs
      .filter((r) => r.sha === latest?.sha)
      .sort((a, b) => a.ranAt - b.ranAt)
      .at(-1)?.passed === true;
  const failing = [...new Set(cases.filter((c) => !passes(c)).map((c) => c.key))].sort();
  return {
    latest: latest ?? null,
    facts: {
      sha: latest?.sha ?? null,
      cases: cases.length,
      passing: cases.length - cases.filter((c) => !passes(c)).length,
      failing,
      runPending: latest ? (row?.pending ?? []).includes(latest.id) : false,
    },
  };
}

/** The reason as the card shows it: "Rejected by evidence guard: ... (AC-01-2)." */
function cardNote(result: GuardResult): string {
  const failing = (result.details?.failing as string[] | undefined) ?? [];
  const reason = result.reason.replace(/\.$/, "");
  return `Rejected by evidence guard: ${reason}${failing.length ? ` (${failing.join(", ")})` : ""}.`;
}

/**
 * The version and lease guards, in that order. An old version is VERSION_OLD only when the caller
 * no longer holds the card's live lease: within a held lease the version rose through the run's own
 * commits and test runs, while a human edit always clears the lease (stage-machine.md section 8,
 * developer decision 2026-10-16). Known gap: the same worker id re-claiming the card lets a late
 * call from its killed run through; a worker runs one card at a time, so that run is already gone.
 */
function versionOrLease(
  card: Record<string, unknown>,
  sent: number,
  workerId: string,
  now: number,
): GuardResult | null {
  const current = { owner: str(card.leaseOwner), until: num(card.leaseUntil) };
  const holds = current.owner === workerId && current.until !== null && current.until >= now;
  const cardVersion = Number(card.version);
  if (sent !== cardVersion && !(holds && sent < cardVersion))
    return versionGuard(sent, cardVersion);
  return lease(current, workerId, now);
}

/**
 * complete_task (contracts.md section 7, C5). Only build workers call it. Guards: version, lease,
 * evidence. An old version is VERSION_OLD only when the caller no longer holds the card's lease:
 * within a held lease the version rose through the run's own commits and test runs, while a human
 * edit always clears the lease (stage-machine.md section 8, developer decision 2026-10-16).
 * `done` closes the card on evidence and opens its merge item (T19); `failed` sends it back to Ready.
 */
export async function completeTaskTool(
  ctx: ToolCtx,
  input: ToolInput<"complete_task">,
): Promise<Outcome<ToolOutput<"complete_task">>> {
  const { agent, workerId } = agentOf(ctx);
  if (agent !== "build") return invalid(`Only build completes cards; this session is ${agent}.`);
  const found = await findOwn(ctx, input.taskId, "Task");
  if (!found.ok) return found;
  const now = ctx.now();
  const refusedFirst = versionOrLease(found.output, input.version, workerId, now);
  if (refusedFirst) return guardFail(ctx, refusedFirst);

  const outcome = input.outcome ?? "done";
  let latest: { id: string; committedAt: number; createdAt: number } | null = null;
  if (outcome === "done") {
    const checked = await evidenceOf(ctx, input.taskId);
    const refused = evidence(checked.facts);
    if (refused) {
      // RUN_PENDING means "wait": not counted, and nothing on the card. Any other reason goes on
      // the card, so the board shows why it did not close.
      if (refused.reasonCode !== "RUN_PENDING") {
        const noted = await setTaskNote(memoryCtx(ctx), {
          taskId: input.taskId,
          note: cardNote(refused),
        });
        if (noted !== null) {
          ctx.events.emit(ctx.binding.projectId, "task.edited", {
            taskId: input.taskId,
            fields: ["note"],
            version: noted,
            actor: agent,
          });
        }
      }
      return guardFail(ctx, refused);
    }
    latest = checked.latest!;
  }

  const done = await completeTask(memoryCtx(ctx), {
    taskId: input.taskId,
    workerId,
    outcome,
    note: input.note ?? null,
    latest,
    now,
  });
  if (!done) {
    // Between the checks and the write a person edited the card (VERSION_OLD), the lease ended, or
    // (done only) a newer build commit arrived, whose tests now run (RUN_PENDING).
    const [row] = await readQuery<{ n: { properties: Record<string, unknown> } }>(
      ctx.db,
      ctx.binding.graph,
      "read/node",
      { id: input.taskId },
    );
    const refused = versionOrLease(row?.n.properties ?? {}, input.version, workerId, ctx.now());
    if (refused || outcome === "failed") {
      return guardFail(ctx, refused ?? lease({ owner: null, until: null }, workerId, ctx.now())!);
    }
    const again = (await evidenceOf(ctx, input.taskId)).facts;
    return guardFail(ctx, evidence(again) ?? evidence({ ...again, runPending: true })!);
  }

  const { projectId } = ctx.binding;
  ctx.events.emit(projectId, "task.moved", {
    taskId: input.taskId,
    key: done.key,
    from: done.from,
    to: done.to,
    version: done.version,
    ...(outcome === "failed" && input.note ? { reason: input.note.slice(0, 200) } : {}),
  });
  ctx.events.emit(projectId, "lease.changed", {
    itemId: input.taskId,
    owner: null,
    until: null,
    reason: "release",
  });
  if (done.mergeItemId) {
    ctx.events.emit(projectId, "node.written", {
      label: "WorkItem",
      id: done.mergeItemId,
      version: 1,
      summary: `merge item open for ${done.key}`,
    });
  }
  if (done.fixed) {
    ctx.events.emit(projectId, "node.written", {
      label: "Defect",
      id: done.fixed.id,
      version: done.fixed.version,
      summary: `Defect fixed by ${done.key}`,
    });
  }
  return ok({ task: { id: input.taskId, key: done.key, column: done.to, version: done.version } });
}
