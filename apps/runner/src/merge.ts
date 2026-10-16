// The merge step (technical design "Steps for one card" 9, stage-machine.md section 3 and C6): a
// build job with no model that merges a Done card's branch into main in the project's repository.
// claim_item gives a merge item only once every card it depends on has a mergedSha, so merges run in
// dependency order. One loop (merge-1) runs them, so two merges never share the main checkout.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { JobFailed, type Job } from "./agent";
import { ensureRepo } from "./repo";
import { removeWorktree } from "./worktree";

const run = promisify(execFile);
const git = async (cwd: string, ...args: string[]) =>
  (await run("git", ["-c", "commit.gpgsign=false", ...args], { cwd })).stdout.trim();
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function mergeJob(opts: { workspacesDir: string }): Job {
  return {
    id: "build",
    worker: "merge-1",
    kinds: ["merge"],
    handoff: [],
    async run(recall, act) {
      const card = recall.context.tasks?.[0];
      if (!card) throw new JobFailed("The merge item has no card.");
      const projectId = recall.project.id;
      const repo = await ensureRepo(projectId, { workspacesDir: opts.workspacesDir }).catch(
        (e: unknown) => {
          throw new JobFailed(`The repository failed: ${message(e)}`.slice(0, 900));
        },
      );
      const branch = `card/${card.key}`;
      // ponytail: merges into whatever the repository has checked out, which only ever is main.
      // A rerun after a crash between the merge and complete_item finds the branch merged ("Already
      // up to date") and reports main's head, which holds the card.
      // A runner that died mid-conflict left the checkout mid-merge; its files are not this card's.
      await git(repo, "merge", "--abort").catch(() => undefined);
      try {
        await git(repo, "merge", "--no-ff", "-m", `Merge ${branch}`, branch);
      } catch (e) {
        const files = (await git(repo, "diff", "--name-only", "--diff-filter=U")).split("\n");
        const conflictFiles = files.map((f) => f.trim()).filter(Boolean);
        if (!conflictFiles.length)
          throw new JobFailed(`git merge failed: ${message(e)}`.slice(0, 900));
        await git(repo, "merge", "--abort");
        const note = `Merge conflict: ${conflictFiles.join(", ")}`;
        await act.say(`${card.key}: ${note}`);
        throw new JobFailed(note, { conflictFiles });
      }
      const mergedSha = await git(repo, "rev-parse", "HEAD");
      // The merge is done; a worktree that will not go only costs disk.
      await removeWorktree(projectId, card.key, opts).catch(() => undefined);
      const summary = `Merged ${branch} into main at ${mergedSha.slice(0, 7)}`;
      await act.say(summary);
      return { outputIds: [card.id], summary, result: { mergedSha } };
    },
  };
}
