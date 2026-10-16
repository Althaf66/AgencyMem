// Build worktrees (technical design "Steps for one card" 2 and 9, sample-app.md section 10): one
// per card at <WORKSPACES_DIR>/<projectId>/wt/<cardKey>, on the branch card/<cardKey> the Test
// agent made. A restarted worker gets the same folder back, with every commit already made.
// AGENTS.md and opencode.json stay out of git through the repository's .git/info/exclude, which
// worktrees share; ensureRepo (task 3.7) wrote it when the project's repository was made.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, rm, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { CardKey, Id } from "@agencymem/contracts";
import { workspacesPath } from "./repo";

const run = promisify(execFile);
const git = (cwd: string, ...args: string[]) => run("git", args, { cwd });
/** npm writes this last, so a crash part-way through `npm ci` leaves it missing. */
const INSTALLED = join("node_modules", ".package-lock.json");

type Options = { workspacesDir: string; install?: boolean };

/** The paths of one card. Both ids are checked first, so no "../" reaches the disk. */
function paths(projectId: string, cardKey: string, opts: Options) {
  const key = CardKey.parse(cardKey);
  const project = resolve(workspacesPath(opts.workspacesDir), Id.parse(projectId));
  const repo = join(project, "repo");
  if (!existsSync(join(repo, ".git")))
    throw new Error(`No repository at ${repo}; ensureRepo makes it.`);
  return {
    repo,
    tree: join(project, "wt", key),
    testTree: join(project, "wt-test", key),
    branch: `card/${key}`,
  };
}

/** Removes a worktree folder: through git when git knows it, else as a plain folder. */
async function removeTree(repo: string, tree: string): Promise<void> {
  // A node_modules link (the Test agent's) goes first, so the removal never reaches its target.
  const link = join(tree, "node_modules");
  if ((await lstat(link).catch(() => null))?.isSymbolicLink()) await unlink(link);
  if (existsSync(join(tree, ".git"))) await git(repo, "worktree", "remove", "--force", tree);
  else await rm(tree, { recursive: true, force: true });
  await git(repo, "worktree", "prune");
}

/**
 * The card's worktree, made on first use and reused after that. `install: false` skips
 * `npm ci` (tests, which have no network).
 */
export async function ensureWorktree(
  projectId: string,
  cardKey: string,
  opts: Options,
): Promise<string> {
  const { repo, tree, testTree, branch } = paths(projectId, cardKey, opts);
  if (!existsSync(join(tree, ".git"))) {
    // A crash can leave git's record of a worktree whose folder is gone, or a folder that
    // `worktree add` never finished. Neither holds a commit: the commits live on the branch.
    await removeTree(repo, tree);
    const exists = await git(repo, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`).then(
      () => true,
      () => false,
    );
    if (!exists) throw new Error(`Branch ${branch} does not exist; the Test agent makes it.`);
    // A Test agent that crashed after write_tests left its wt-test worktree on the branch, and git
    // checks a branch out in one worktree only. Its specs are committed, so it can go.
    const { stdout } = await git(repo, "worktree", "list", "--porcelain");
    if (stdout.includes(`branch refs/heads/${branch}\n`) && existsSync(testTree)) {
      await removeTree(repo, testTree);
    }
    await git(repo, "worktree", "add", tree, branch);
  }
  // npm ci, not a link: OpenCode may add a package (sample-app.md section 10).
  if (opts.install !== false && !existsSync(join(tree, INSTALLED))) {
    // npm is npm.cmd on Windows, which Node runs only through a shell.
    await run("npm", ["ci", "--prefer-offline", "--no-audit", "--no-fund"], {
      cwd: tree,
      shell: process.platform === "win32",
    });
  }
  return tree;
}

/** Removes the card's worktree after its merge. The branch and its commits stay. */
export async function removeWorktree(
  projectId: string,
  cardKey: string,
  opts: Options,
): Promise<void> {
  const { repo, tree } = paths(projectId, cardKey, opts);
  await removeTree(repo, tree);
}
