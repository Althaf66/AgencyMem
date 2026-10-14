import { reject, type GuardResult } from "./run";

type Lease = { owner: string | null; until: number | null };

/**
 * Rejects work on an item or card whose lease ended or belongs to another worker. The caller must
 * stop at once. A lease is live up to and including `until`.
 */
export function lease(current: Lease, workerId: string, now: number): GuardResult | null {
  if (current.owner !== null && current.owner !== workerId) {
    return reject(
      "lease",
      "LEASE_OTHER_WORKER",
      `Another worker (${current.owner}) holds this lease.`,
      {
        owner: current.owner,
        until: current.until,
      },
    );
  }
  if (current.owner === null || current.until === null || current.until < now) {
    return reject("lease", "LEASE_ENDED", "Your lease has ended; stop work on this item.", {
      owner: current.owner,
      until: current.until,
    });
  }
  return null;
}

/** Rejects a claim by id on an item someone else holds (claim_item or claim_task with an id). */
export function leaseHeld(current: Lease): GuardResult {
  return reject("lease", "LEASE_HELD", "This item is held by another worker.", {
    owner: current.owner,
    until: current.until,
  });
}
