// Task 4.3, Done when: a restarted worker reuses the worktree and its commits. Real git in a
// temporary WORKSPACES_DIR; npm ci is skipped (install: false), so the test needs no network.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureRepo } from "./repo";
import { ensureWorktree, removeWorktree } from "./worktree";

const run = promisify(execFile);
const PID = "01JA0000000000000000000002";
const workspaces = mkdtempSync(join(tmpdir(), "am-ws-"));
const opts = { workspacesDir: workspaces, install: false };
let repo: string;

// No hooks here: the post-commit hook is tested in repo.test.ts.
const git = async (cwd: string, ...args: string[]) =>
  (
    await run("git", ["-c", "core.hooksPath=no-hooks", "-c", "commit.gpgsign=false", ...args], {
      cwd,
    })
  ).stdout.trim();

beforeAll(async () => {
  repo = await ensureRepo(PID, opts);
  // The Test agent made the card branches, with the specs on them.
  for (const key of ["CARD-01", "CARD-02", "CARD-03", "CARD-04"]) {
    await git(repo, "branch", `card/${key}`, "main");
  }
});
afterAll(() => rmSync(workspaces, { recursive: true, force: true }));

// Real git on Windows is slow under a full test run.
describe("ensureWorktree and removeWorktree", { timeout: 30_000 }, () => {
  it("Done when: a restarted worker reuses the worktree and its commits", async () => {
    const tree = await ensureWorktree(PID, "CARD-01", opts);
    expect(tree).toBe(join(workspaces, PID, "wt", "CARD-01"));
    expect(await git(tree, "rev-parse", "--abbrev-ref", "HEAD")).toBe("card/CARD-01");
    writeFileSync(join(tree, "work.txt"), "first run\n");
    await git(tree, "add", "work.txt");
    await git(tree, "commit", "-m", "feat(CARD-01): first run");
    const sha = await git(tree, "rev-parse", "HEAD");

    // A restart: no state in memory, the same call again.
    expect(await ensureWorktree(PID, "CARD-01", opts)).toBe(tree);
    expect(await git(tree, "rev-parse", "HEAD")).toBe(sha);

    // A crash that lost the folder but left git's worktree record: the record is pruned and the
    // worktree comes back on the branch, with the commit.
    rmSync(tree, { recursive: true, force: true });
    expect(await ensureWorktree(PID, "CARD-01", opts)).toBe(tree);
    expect(await git(tree, "rev-parse", "HEAD")).toBe(sha);
    expect(existsSync(join(tree, "work.txt"))).toBe(true);
  });

  it("keeps AGENTS.md and opencode.json out of git", async () => {
    const tree = await ensureWorktree(PID, "CARD-02", opts);
    writeFileSync(join(tree, "AGENTS.md"), "# Card CARD-02\n");
    writeFileSync(join(tree, "opencode.json"), "{}\n");
    expect(await git(tree, "status", "--porcelain")).toBe("");
  });

  it("removes the worktree after the merge and keeps the branch and its commits", async () => {
    const tree = await ensureWorktree(PID, "CARD-02", opts);
    await git(tree, "commit", "--allow-empty", "-m", "feat(CARD-02): done");
    const sha = await git(tree, "rev-parse", "HEAD");

    await removeWorktree(PID, "CARD-02", opts);
    expect(existsSync(tree)).toBe(false);
    expect(await git(repo, "worktree", "list")).not.toContain("CARD-02");
    expect(await git(repo, "rev-parse", "card/CARD-02")).toBe(sha);
    await removeWorktree(PID, "CARD-02", opts); // already gone: nothing to do
  });

  it("replaces a folder that a crash left half made", async () => {
    const tree = join(workspaces, PID, "wt", "CARD-04");
    mkdirSync(tree, { recursive: true });
    writeFileSync(join(tree, "partial.txt"), "no .git here");

    expect(await ensureWorktree(PID, "CARD-04", opts)).toBe(tree);
    expect(await git(tree, "rev-parse", "--abbrev-ref", "HEAD")).toBe("card/CARD-04");
    expect(existsSync(join(tree, "partial.txt"))).toBe(false);
  });

  it("frees the branch from a Test agent worktree a crash left behind, without touching its link target", async () => {
    const testTree = join(workspaces, PID, "wt-test", "CARD-03");
    await git(repo, "worktree", "add", testTree, "card/CARD-03");
    const target = mkdtempSync(join(tmpdir(), "am-nm-"));
    writeFileSync(join(target, "keep.txt"), "the repository's install");
    symlinkSync(target, join(testTree, "node_modules"), "junction");

    const tree = await ensureWorktree(PID, "CARD-03", opts);
    expect(await git(tree, "rev-parse", "--abbrev-ref", "HEAD")).toBe("card/CARD-03");
    expect(existsSync(testTree)).toBe(false);
    expect(existsSync(join(target, "keep.txt"))).toBe(true);
    rmSync(target, { recursive: true, force: true });
  });

  it("removes a folder git does not know as a worktree", async () => {
    const tree = join(workspaces, PID, "wt", "CARD-05");
    mkdirSync(tree, { recursive: true });
    await removeWorktree(PID, "CARD-05", opts);
    expect(existsSync(tree)).toBe(false);
  });

  it("refuses a missing branch, a bad key and a project with no repository, before touching the disk", async () => {
    await expect(ensureWorktree(PID, "CARD-09", opts)).rejects.toThrow("card/CARD-09");
    await expect(ensureWorktree(PID, "../CARD-01", opts)).rejects.toThrow();
    const other = "01JA0000000000000000000003";
    await expect(ensureWorktree(other, "CARD-01", opts)).rejects.toThrow("No repository");
    expect(existsSync(join(workspaces, other))).toBe(false);
  });
});
