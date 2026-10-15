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
