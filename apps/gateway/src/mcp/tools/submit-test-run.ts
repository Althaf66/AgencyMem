import type { Context, ToolInput, ToolOutput, WorkItemKind } from "@agencymem/contracts";
import { readQuery } from "@agencymem/graph";
import { recordTestRuns } from "@agencymem/memory";
import { ownership, reject, source } from "../guards";
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
type CodeChangeRow = { id: string; sha: string; taskId: string | null };

/**
 * submit_test_run (contracts.md section 7). Guards: ownership (a test_run or e2e item), source
 * (each result names a TestCase of the card). The card's run is checked against the item's
 * subject: its sha and its card. One TestRun per result; a failure sends a card in Testing back to
 * In progress with the failing criterion keys as its note.
 */
export async function submitTestRunTool(
  ctx: ToolCtx,
  input: ToolInput<"submit_test_run">,
): Promise<Outcome<ToolOutput<"submit_test_run">>> {
  const { agent } = agentOf(ctx);
  const found = await findOwn(ctx, input.itemId, "WorkItem");
  if (!found.ok) return found;
  const kind = found.output.kind as WorkItemKind;
  const refused = ownership({ kind: "agent", agent }, "submit_test_run", { itemKind: kind });
  if (refused) return guardFail(ctx, refused);
  // ponytail: the run of every spec on main (an e2e item, without taskId) arrives with task 5.1.
  if (kind === "e2e") return invalid("The e2e run is not built yet (task 5.1).");
  if (!input.taskId) return invalid("A test_run item's results need the card's taskId.");

  const { db } = ctx;
  const { graph, projectId } = ctx.binding;
  const [change] = await readQuery<CodeChangeRow>(db, graph, "read/code-change", {
    projectId,
    id: String(found.output.subjectId),
  });
  if (!change || change.sha !== input.sha || change.taskId !== input.taskId) {
    return invalid(`Item ${input.itemId} tests another commit or card.`);
  }
  const [task] = await readQuery<TaskRow>(db, graph, "read/task", {
    projectId,
    taskId: input.taskId,
  });
  if (!task) return invalid(`Task ${input.taskId} does not exist.`);
  const cases = new Map(task.testCases.map((c) => [c.id, c.criterionKey]));
  const missing = source(
    input.results.map((r) => ({ ids: [r.testCaseId] })),
    new Set(cases.keys()),
  );
  if (missing) return guardFail(ctx, missing);

  const failing = [
    ...new Set(input.results.filter((r) => !r.passed).map((r) => cases.get(r.testCaseId)!)),
  ].sort();
  const written = await recordTestRuns(memoryCtx(ctx), {
    sha: input.sha,
    taskId: input.taskId,
    results: input.results,
    note: failing.length ? `Tests failed: ${failing.join(", ")}` : null,
    createdBy: agent,
    now: ctx.now(),
  });

  const { testRunIds, from, to, version } = written;
  // TestCases are never deleted (write_tests MERGEs them), so every result finds its case; a short
  // count would mean the graph changed under the check above.
  if (testRunIds.length !== input.results.length) {
    return guardFail(ctx, reject("source", "SOURCE_UNKNOWN", "A TestCase of the card is gone."));
  }
  ctx.events.emit(projectId, "node.written", {
    label: "TestRun",
    id: testRunIds[0]!,
    version: 1,
    summary: `${testRunIds.length} test runs for ${task.key} at ${input.sha.slice(0, 7)}`,
    ids: testRunIds,
  });
  if (from && to && from !== to && version !== null) {
    ctx.events.emit(projectId, "task.moved", {
      taskId: task.id,
      key: task.key,
      from,
      to,
      version,
      reason: `Tests failed: ${failing.join(", ")}`.slice(0, 200),
    });
  }
  return ok({ testRunIds, allPassed: failing.length === 0, taskColumn: to });
}
