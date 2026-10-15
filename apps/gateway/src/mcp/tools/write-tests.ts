import type { Context, ToolInput, ToolOutput, WorkItemKind } from "@agencymem/contracts";
import { readQuery } from "@agencymem/graph";
import { writeTests } from "@agencymem/memory";
import { ownership, reject, source } from "../guards";
import { runStage } from "../../stage/effects";
import {
  agentOf,
  findOwn,
  guardFail,
  invalid,
  memoryCtx,
  ok,
  type Outcome,
  type ToolCtx,
} from "./common";

type TaskRow = NonNullable<Context["tasks"]>[number];

/**
 * write_tests (contracts.md section 7). Guards: ownership (a write_tests item), source (each case
 * names a criterion of the card). The card is the item's subject. TestCases MERGE by file; the
 * card moves to Ready when every criterion has one, and the first Ready card starts the build (T16).
 */
export async function writeTestsTool(
  ctx: ToolCtx,
  input: ToolInput<"write_tests">,
): Promise<Outcome<ToolOutput<"write_tests">>> {
  const { agent } = agentOf(ctx);
  const found = await findOwn(ctx, input.itemId, "WorkItem");
  if (!found.ok) return found;
  const refused = ownership({ kind: "agent", agent }, "write_tests", {
    itemKind: found.output.kind as WorkItemKind,
  });
  if (refused) return guardFail(ctx, refused);
  if (found.output.subjectId !== input.taskId) {
    return invalid(`Task ${input.taskId} is not the subject of item ${input.itemId}.`);
  }

  const { db } = ctx;
  const { graph, projectId } = ctx.binding;
  const [task] = await readQuery<TaskRow>(db, graph, "read/task", {
    projectId,
    taskId: input.taskId,
  });
  if (!task) return invalid(`Task ${input.taskId} does not exist.`);
  const missing = source(
    input.cases.map((c) => ({ ids: [c.criterionKey] })),
    new Set(task.criteria.map((k) => k.key)),
  );
  if (missing) return guardFail(ctx, missing);

  const written = await writeTests(memoryCtx(ctx), {
    taskId: input.taskId,
    cases: input.cases,
    createdBy: agent,
    now: ctx.now(),
  });
  if (!written) {
    // A criterion left the card between the check above and the write.
    return guardFail(ctx, reject("source", "SOURCE_UNKNOWN", "The card's criteria changed."));
  }

  const { testCaseIds, caseVersion, from, to, version } = written;
  if (testCaseIds.length) {
    ctx.events.emit(projectId, "node.written", {
      label: "TestCase",
      id: testCaseIds[0]!,
      version: caseVersion,
      summary: `${testCaseIds.length} test cases for ${task.key}`,
      ids: testCaseIds,
    });
  }
  if (from !== to) {
    ctx.events.emit(projectId, "task.moved", { taskId: task.id, key: task.key, from, to, version });
    await runStage(db, ctx.events, projectId, { type: "card_ready" });
  }
  return ok({ testCaseIds, taskColumn: to });
}
