// What a guard returns, the order guards run in, and how a rejection is counted (contracts.md
// section 6). Each guard is a pure function over the facts it needs; tools read those facts first.
import {
  rejectionCounter,
  type Actor,
  type GuardName,
  type ReasonCode,
  type Rejection,
} from "@agencymem/contracts";
import type { FalkorDB } from "@agencymem/graph";
import { countRejection } from "@agencymem/memory";
import type { Events } from "../../events/bus";

export type GuardResult = {
  guard: GuardName;
  reasonCode: ReasonCode;
  reason: string; // one sentence a person can read on the card or in the log
  details?: Record<string, unknown>;
};

/** Builds a guard's result; the reason code must belong to that guard. */
export function reject<G extends GuardName>(
  guard: G,
  reasonCode: ReasonCode<G>,
  reason: string,
  details?: Record<string, unknown>,
): GuardResult {
  return { guard, reasonCode, reason, ...(details ? { details } : {}) };
}

/**
 * AGENTS.md rule 8: tenancy, ownership, gate, source, version, lease, evidence. deps, read-only and
 * anonymity take the place their tool rows give them in contracts.md section 7: read_query has
 * read-only alone, write_case_study runs ownership then anonymity, claim_task runs deps then lease.
 */
export const GUARD_ORDER: readonly GuardName[] = [
  "tenancy",
  "ownership",
  "read-only",
  "gate",
  "source",
  "anonymity",
  "version",
  "deps",
  "lease",
  "evidence",
];

export type GuardCheck = {
  guard: GuardName;
  check: () => GuardResult | null | Promise<GuardResult | null>;
};

/** Runs the checks in GUARD_ORDER, whatever order they are given in. Stops at the first rejection. */
export async function runGuards(checks: GuardCheck[]): Promise<GuardResult | null> {
  const ordered = [...checks].sort(
    (a, b) => GUARD_ORDER.indexOf(a.guard) - GUARD_ORDER.indexOf(b.guard),
  );
  for (const { check } of ordered) {
    const result = await check();
    if (result) return result;
  }
  return null;
}

/**
 * Turns a guard result into the contract's Rejection, adds 1 to the Project counter it belongs to,
 * then sends write.rejected and metrics.updated (contracts.md section 6, "Counting"). RUN_PENDING
 * means "wait", not "wrong": it is neither counted nor sent.
 */
export async function rejectAndCount(
  db: FalkorDB,
  projectId: string,
  result: GuardResult,
  at: { events: Events; tool: string; agent: Actor },
): Promise<Rejection> {
  const counter = rejectionCounter(result.guard, result.reasonCode);
  // No such project (tenancy PROJECT_MISSING or PROJECT_UNKNOWN): nothing to count, and no event,
  // so a request that names a made-up project id leaves no seq or buffer behind.
  const value = counter && projectId ? await countRejection(db, projectId, counter) : null;
  if (counter && value !== null) {
    at.events.emit(projectId, "write.rejected", {
      tool: at.tool,
      guard: result.guard,
      reasonCode: result.reasonCode,
      reason: result.reason,
      agent: at.agent,
    });
    at.events.emit(projectId, "metrics.updated", { metric: counter, value });
  }
  return {
    code: "GUARD_REJECTED",
    guard: result.guard,
    reason: result.reason,
    details: { reasonCode: result.reasonCode, ...result.details },
  };
}
