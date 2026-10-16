// The Test agent's e2e job (agent-prompts.md section 7, no model): the same as test_run, on main at
// its latest commit with every spec file, and submit_test_run without taskId (T20 opens it after the
// last build card merges; T21 opens launch when it is done, pass or fail).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { JobFailed, type ActResult, type Job } from "../../agent";
import { ensureRepo } from "../../repo";
import { resultsFor, runSpecs, step } from "./run-tests";

const run = promisify(execFile);

export function e2eJob(opts: { workspacesDir: string }): Job {
  return {
    id: "test",
    worker: "test-e2e-1",
    kinds: ["e2e"],
    handoff: [],
    async run(recall, act): Promise<ActResult> {
      const cases = (recall.context.tasks ?? []).flatMap((t) => t.testCases);
      if (!cases.length) throw new JobFailed("No card has a TestCase to run.");
      const repo = await step("The repository", () =>
        ensureRepo(recall.project.id, { workspacesDir: opts.workspacesDir }),
      );
      const sha = await step("Reading main", async () =>
        (await run("git", ["rev-parse", "main"], { cwd: repo })).stdout.trim(),
      );
      await act.say(`Running all ${cases.length} specs on main at ${sha.slice(0, 7)}`);
      const report = await runSpecs({
        repo,
        sha,
        specs: "tests/e2e",
        lost: () => act.lost?.() ?? false,
      });
      const results = resultsFor(cases, report);
      const { testRunIds } = await act.call("submit_test_run", {
        itemId: recall.item.id,
        sha,
        results,
      });
      const passed = results.filter((r) => r.passed).length;
      const summary = `${passed} of ${results.length} tests passed on main at ${sha.slice(0, 7)}`;
      await act.say(summary);
      return { outputIds: testRunIds, summary };
    },
  };
}
