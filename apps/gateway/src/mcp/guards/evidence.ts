import { reject, type GuardResult } from "./run";

/** How long OpenCode waits before it calls complete_task again (contracts.md section 12). */
export const RUN_PENDING_RETRY_MS = 30_000;

/**
 * Rejects closing a card without proof: no recorded commit, no test cases, a test run still going
 * on the latest commit (RUN_PENDING, C5: wait, not counted), or a failing run. The facts come from
 * evidence.cypher; `failing` holds the criterion keys of the failing cases.
 */
export function evidence(e: {
  sha: string | null;
  cases: number;
  passing: number;
  failing: string[];
  runPending: boolean;
}): GuardResult | null {
  if (e.sha === null) {
    return reject("evidence", "NO_COMMIT", "The card has no recorded commit.");
  }
  if (e.cases === 0) {
    return reject("evidence", "NO_TESTS", "The card has no test cases.", { sha: e.sha, cases: 0 });
  }
  if (e.runPending) {
    return reject("evidence", "RUN_PENDING", "Tests are still running on the latest commit.", {
      sha: e.sha,
      retryAfterMs: RUN_PENDING_RETRY_MS,
    });
  }
  if (e.passing < e.cases) {
    return reject("evidence", "RUN_FAILED", "Not every test passes on the latest commit.", {
      sha: e.sha,
      cases: e.cases,
      passing: e.passing,
      failing: e.failing,
    });
  }
  return null;
}
