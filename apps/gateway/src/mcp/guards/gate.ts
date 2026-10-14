import type { GateKey, GateStatus } from "@agencymem/contracts";
import { reject, type GuardResult } from "./run";

/** Rejects a write when the gate before its stage is not approved. No Gate node counts as not approved. */
export function gate(key: GateKey, current: { status: GateStatus } | null): GuardResult | null {
  if (current?.status === "approved") return null;
  return reject("gate", "GATE_NOT_APPROVED", `Gate ${key} is not approved.`, {
    gateKey: key,
    status: current?.status ?? null,
  });
}
