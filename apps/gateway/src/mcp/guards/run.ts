// What a guard returns, the order guards run in, and how a rejection is counted (contracts.md
// section 6). Each guard is a pure function over the facts it needs; tools read those facts first.
import {
  rejectionCounter,
  type GuardName,
  type ReasonCode,
  type Rejection,
} from "@agencymem/contracts";
import type { FalkorDB } from "@agencymem/graph";
import { countRejection } from "@agencymem/memory";

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
 * Turns a guard result into the contract's Rejection and adds 1 to the Project counter it belongs
 * to. RUN_PENDING means "wait", so it is not counted.
 */
export async function rejectAndCount(
  db: FalkorDB,
  projectId: string,
  result: GuardResult,
): Promise<Rejection> {
  const counter = rejectionCounter(result.guard, result.reasonCode);
  if (counter) await countRejection(db, projectId, counter);
  return {
    code: "GUARD_REJECTED",
    guard: result.guard,
    reason: result.reason,
    details: { reasonCode: result.reasonCode, ...result.details },
  };
}
