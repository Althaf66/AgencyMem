// Commits from the post-commit hook (contracts.md section 9): one CodeChange per sha, linked to its
// card, and T17 in the same query.
import { CardKey, CodeChange, type Actor, type Column, type WorkItem } from "@agencymem/contracts";
import { writeQuery } from "@agencymem/graph/write";
import { ulid } from "ulid";
import type { Ctx } from "./ctx";

export type RecordedCommit = {
  codeChange: CodeChange;
  /** False when the sha was already recorded: the first record comes back, nothing else changed. */
  created: boolean;
  task: { id: string; key: string; from: Column; to: Column; version: number } | null;
  workItemId: WorkItem["id"] | null;
};

/** Records one commit; on T17 the card moves to Testing and a test_run item opens for it. */
export async function recordCommit(
  ctx: Ctx,
  input: {
    sha: string;
    branch: string;
    files: string[];
    message: string;
    author: string;
    committedAt: number;
    now: number;
  },
): Promise<RecordedCommit> {
  const key = input.branch.startsWith("card/") ? input.branch.slice("card/".length) : "";
  const cardKey = CardKey.safeParse(key).success ? key : null;
  // The Test agent commits as agencymem-test; every other commit comes from a build run.
  const createdBy: Actor = input.author === "agencymem-test" ? "test" : "build";
  const [row] = await writeQuery<{
    c: { properties: Record<string, unknown> };
    created: boolean;
    taskId: string | null;
    taskKey: string | null;
    fromColumn: Column | null;
    toColumn: Column | null;
    taskVersion: number | null;
    workItemId: string | null;
  }>(ctx.db, ctx.graph, "write/record-commit", {
    projectId: ctx.projectId,
    id: ulid(),
    itemId: ulid(),
    cardKey,
    createdBy,
    ...input,
  });
  if (!row) throw new Error("record-commit returned no row");
  return {
    codeChange: CodeChange.parse(row.c.properties),
    created: row.created,
    task:
      row.taskId && row.taskKey && row.fromColumn && row.toColumn && row.taskVersion !== null
        ? {
            id: row.taskId,
            key: row.taskKey,
            from: row.fromColumn,
            to: row.toColumn,
            version: row.taskVersion,
          }
        : null,
    workItemId: row.workItemId,
  };
}
