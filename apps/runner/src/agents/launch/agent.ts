// The Launch agent (agent-prompts.md section 10, rule-based, no model): the four graph checks come
// from recall_context, the drift check from git log here; write_handoff stores all five as the
// ReadinessReport that G5 reads (T22).
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ReadinessCheck } from "@agencymem/contracts";
import { JobFailed, type ActResult, type Job } from "../../agent";
import { repoPath } from "../../repo";

const run = promisify(execFile);
const SHOWN = 5;
const commits = (n: number) => `${n} ${n === 1 ? "commit" : "commits"}`;

/**
 * Drift: a commit on main with no CodeChange, or a CodeChange the hook could not link to a card,
 * fails. The commits come without merges and without the root (the unreported starter commit).
 */
export function driftCheck(
  mainShas: string[],
  changes: { id: string; sha: string; linked: boolean }[],
): ReadinessCheck {
  const known = new Set(changes.map((c) => c.sha));
  const unlinked = changes.filter((c) => !c.linked);
  const bad = [...mainShas.filter((s) => !known.has(s)), ...unlinked.map((c) => c.sha)];
  if (!bad.length) {
    return {
      name: "drift",
      passed: true,
      detail: `All ${commits(mainShas.length)} on main are recorded`,
      nodeIds: [],
    };
  }
  const shown = bad.slice(0, SHOWN).map((s) => s.slice(0, 7));
  const more = bad.length > SHOWN ? ` and ${bad.length - SHOWN} more` : "";
  return {
    name: "drift",
    passed: false,
    detail: `${commits(bad.length)} not recorded or not linked: ${shown.join(", ")}${more}`.slice(
      0,
      200,
    ),
    nodeIds: unlinked.map((c) => c.id),
  };
}

export function launchJob(opts: { workspacesDir: string }): Job {
  return {
    id: "launch",
    worker: "launch-1",
    kinds: ["launch"],
    handoff: [], // the handoff carries the report, so run() writes it
    async run(recall, act): Promise<ActResult> {
      const checks = recall.context.readiness;
      if (!checks) throw new JobFailed("recall_context gave no readiness checks.");
      // Never made here: a fresh starter repository would have no commits, and drift would pass.
      const repo = repoPath(recall.project.id, opts.workspacesDir);
      if (!existsSync(join(repo, ".git"))) {
        throw new JobFailed(`The project repository is missing: ${repo}`);
      }
      let mainShas: string[];
      try {
        const { stdout } = await run(
          "git",
          ["rev-list", "--no-merges", "--min-parents=1", "main"],
          { cwd: repo },
        );
        mainShas = stdout.split("\n").filter(Boolean);
      } catch (e) {
        throw new JobFailed(`git log on main failed: ${e instanceof Error ? e.message : e}`);
      }
      const all = [...checks, driftCheck(mainShas, recall.context.codeChanges ?? [])];
      const passed = all.filter((c) => c.passed).length;
      const summary = `Readiness: ${passed} of ${all.length} checks passed`;
      const { reportId } = await act.call("write_handoff", {
        itemId: recall.item.id,
        summary,
        outputIds: [],
        report: { checks: all },
      });
      await act.say(summary);
      return { outputIds: reportId ? [reportId] : [], summary };
    },
  };
}
