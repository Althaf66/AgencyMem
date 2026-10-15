// contracts.md section 6: errors, guard reason codes, counting and HTTP status.
import { z } from "zod";
import { GuardName } from "./enums";

export const ErrorCode = z.enum([
  "VALIDATION_FAILED",
  "UNAUTHORIZED",
  "GUARD_REJECTED",
  "NOT_FOUND",
  "GRAPH_UNAVAILABLE",
  "INTERNAL",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** The `details.reasonCode` values of each guard. */
export const REASON_CODES = {
  tenancy: ["PROJECT_MISSING", "PROJECT_UNKNOWN", "FOREIGN_NODE"],
  ownership: ["LABEL_NOT_OWNED", "ITEM_KIND_NOT_OWNED"],
  // WRONG_STAGE (P, task 2.2): a stage-bound route called in another stage, such as an upload
  // after intake (stage-machine.md T2), with `stage` in details.
  // GATE_NOT_DECIDABLE (P, task 2.7): a decision on a gate whose rules do not allow one yet
  // (stage-machine.md section 5), with `gateKey` and `blockedBy` in details.
  gate: ["GATE_NOT_APPROVED", "WRONG_STAGE", "GATE_NOT_DECIDABLE"],
  source: ["SOURCE_MISSING", "SOURCE_UNKNOWN"],
  version: ["VERSION_OLD"],
  lease: ["LEASE_ENDED", "LEASE_OTHER_WORKER", "LEASE_HELD"],
  evidence: ["NO_COMMIT", "NO_TESTS", "RUN_PENDING", "RUN_FAILED"],
  deps: ["DEPS_OPEN"],
  "read-only": ["WRITE_CLAUSE", "NOT_UI_SESSION"],
  anonymity: ["NAME_FOUND", "EMAIL_FOUND", "URL_FOUND"],
} as const satisfies Record<GuardName, readonly string[]>;

export type ReasonCode<G extends GuardName = GuardName> = (typeof REASON_CODES)[G][number];
export const ReasonCode = z.enum(
  Object.values(REASON_CODES).flat() as [ReasonCode, ...ReasonCode[]],
);

export const Rejection = z
  .object({
    code: ErrorCode,
    guard: GuardName.optional(),
    reason: z.string().min(1),
    details: z.looseObject({ reasonCode: z.string().optional() }).optional(),
  })
  .refine((r) => (r.code === "GUARD_REJECTED") === (r.guard !== undefined), {
    message: "guard is set exactly when code is GUARD_REJECTED",
    path: ["guard"],
  });
export type Rejection = z.infer<typeof Rejection>;

/** The body of every failed REST call. */
export const ErrorBody = z.object({ error: Rejection });
export type ErrorBody = z.infer<typeof ErrorBody>;

export const RejectionCounter = z.enum([
  "rejectedWrites",
  "rejectedClaims",
  "rejectedCompletions",
  "rejectedQueries",
]);
export type RejectionCounter = z.infer<typeof RejectionCounter>;

/** The Project counter a guard rejection adds 1 to, or null for RUN_PENDING (it means "wait"). */
export function rejectionCounter<G extends GuardName>(
  guard: G,
  reasonCode: ReasonCode<G>,
): RejectionCounter | null {
  if (reasonCode === "RUN_PENDING") return null;
  if (guard === "deps" || reasonCode === "LEASE_HELD") return "rejectedClaims"; // claim_task, claim_item
  if (guard === "evidence") return "rejectedCompletions";
  if (guard === "read-only") return "rejectedQueries";
  return "rejectedWrites";
}

const STATUS: Record<Exclude<ErrorCode, "GUARD_REJECTED">, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  GRAPH_UNAVAILABLE: 503,
  INTERNAL: 500,
};
const GUARD_STATUS: Record<GuardName, number> = {
  tenancy: 403,
  ownership: 403,
  "read-only": 403,
  gate: 409,
  version: 409,
  lease: 409,
  evidence: 409,
  deps: 409,
  source: 422,
  anonymity: 422,
};

export function httpStatus(rejection: Rejection): number {
  if (rejection.code !== "GUARD_REJECTED") return STATUS[rejection.code];
  return rejection.guard ? GUARD_STATUS[rejection.guard] : 500;
}
