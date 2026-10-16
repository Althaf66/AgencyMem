// TestCases (write_tests). One Cypher query per call.
import { text, type Actor, type Column } from "@agencymem/contracts";
import { writeQuery } from "@agencymem/graph/write";
import { ulid } from "ulid";
import type { Ctx } from "./ctx";

export type TestCaseWrite = { criterionKey: string; file: string; title: string };

/**
 * Records the card's spec files as TestCases that VERIFY their criteria; moves the card to Ready
 * when every criterion has one. Ids follow the input order. Null when a criterion is not the
 * card's; nothing is written then.
 */
export async function writeTests(
  ctx: Ctx,
  input: { taskId: string; cases: TestCaseWrite[]; createdBy: Actor; now: number },
): Promise<{
  testCaseIds: string[];
  /** The highest version among the written TestCases (a retry raises it). */
  caseVersion: number;
  from: Column;
  to: Column;
  version: number;
} | null> {
  const rows = await writeQuery<{
    cases: [string, string][];
    caseVersion: number;
    before: Column;
    after: Column;
    version: number;
  }>(ctx.db, ctx.graph, "write/write-tests", {
    projectId: ctx.projectId,
    taskId: input.taskId,
    cases: input.cases.map((c) => ({ ...c, id: ulid(), title: text(200).parse(c.title) })),
    createdBy: input.createdBy,
    now: input.now,
  });
  const row = rows[0];
  if (!row) return null;
  const idOf = new Map(row.cases);
  return {
    testCaseIds: input.cases.map((c) => idOf.get(c.file)!),
    caseVersion: row.caseVersion,
    from: row.before,
    to: row.after,
    version: row.version,
  };
}

export type TestResult = {
  testCaseId: string;
  passed: boolean;
  durationMs: number;
  error?: string;
};

/**
 * Records one TestRun per result, tagged with the commit's sha. With `taskId` (scope "card") and
 * the card in Testing, a failure moves the card to In progress with `note`. Ids follow the input
 * order. The caller checks that every TestCase is the card's first: a missing one writes no run.
 */
export async function recordTestRuns(
  ctx: Ctx,
  input: {
    sha: string;
    taskId: string | null;
    results: TestResult[];
    note: string | null;
    createdBy: Actor;
    now: number;
  },
): Promise<{
  testRunIds: string[];
  from: Column | null;
  to: Column | null;
  version: number | null;
}> {
  const results = input.results.map((r) => ({ ...r, id: ulid(), error: r.error ?? null }));
  const rows = await writeQuery<{
    id: string;
    fromColumn: Column | null;
    toColumn: Column | null;
    taskVersion: number | null;
  }>(ctx.db, ctx.graph, "write/submit-test-run", {
    projectId: ctx.projectId,
    taskId: input.taskId,
    sha: input.sha,
    scope: input.taskId ? "card" : "e2e",
    failed: results.some((r) => !r.passed),
    note: input.note === null ? null : input.note.slice(0, 500), // Task.note is at most 500
    results,
    createdBy: input.createdBy,
    now: input.now,
  });
  const ids = new Set(rows.map((r) => r.id));
  return {
    testRunIds: results.map((r) => r.id).filter((id) => ids.has(id)),
    from: rows[0]?.fromColumn ?? null,
    to: rows[0]?.toColumn ?? null,
    version: rows[0]?.taskVersion ?? null,
  };
}
