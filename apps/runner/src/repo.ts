// The project's code repository (sample-app.md section 10): the clinic booking starter in
// <WORKSPACES_DIR>/<projectId>/repo, one "chore: starter" commit, then the post-commit hook. Every
// step is safe to run again, so a crash half-way is finished by the next call.
import { execFile } from "node:child_process";
import { appendFile, chmod, copyFile, cp, mkdir, readFile, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Id } from "@agencymem/contracts";

const run = promisify(execFile);
const AGENCYMEM_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const STARTER = fileURLToPath(new URL("../templates/app-starter", import.meta.url));
/** Files the build worker writes into each worktree; they never reach a commit. */
const EXCLUDED = ["AGENTS.md", "opencode.json"];

const git = (cwd: string, ...args: string[]) => run("git", args, { cwd });

/**
 * WORKSPACES_DIR as a full path. A relative value is read from the AgencyMem root, where .env
 * lives, not from the folder an app runs in (pnpm dev starts the runner in apps/runner), so the
 * default ../agencymem-workspaces is a sibling of the repository.
 */
export const workspacesPath = (dir: string): string => resolve(AGENCYMEM_ROOT, dir);

/** True when `path` is the AgencyMem repository or inside it. */
export function insideAgencyMem(path: string): boolean {
  const rel = relative(AGENCYMEM_ROOT, path);
  return !rel.startsWith("..") && !isAbsolute(rel);
}

async function hasCommit(repo: string): Promise<boolean> {
  if (!existsSync(join(repo, ".git"))) return false;
  return git(repo, "rev-parse", "--verify", "HEAD").then(
    () => true,
    () => false,
  );
}

/**
 * Makes sure the project's repository exists and returns its path. `install: false` skips
 * `npm ci` (tests, which have no network).
 */
export async function ensureRepo(
  projectId: string,
  opts: { workspacesDir: string; install?: boolean },
): Promise<string> {
  const repo = resolve(workspacesPath(opts.workspacesDir), Id.parse(projectId), "repo"); // no "../" in the path
  if (insideAgencyMem(repo)) {
    throw new Error(`WORKSPACES_DIR ${opts.workspacesDir} is inside the AgencyMem repository`);
  }

  if (!(await hasCommit(repo))) {
    await mkdir(repo, { recursive: true });
    await cp(STARTER, repo, {
      recursive: true,
      filter: (src) => !relative(STARTER, src).split(/[\\/]/).includes("node_modules"),
    });
    // Runs again after a crash mid-install: npm ci replaces a partial node_modules.
    if (opts.install !== false) {
      // npm is npm.cmd on Windows, which Node runs only through a shell.
      await run("npm", ["ci", "--no-audit", "--no-fund"], {
        cwd: repo,
        shell: process.platform === "win32",
      });
    }
    await git(repo, "init", "-b", "main");
    await git(repo, "config", "user.name", "agencymem");
    await git(repo, "config", "user.email", "runner@agencymem.local");
    await git(repo, "add", "-A");
    // A machine-wide commit.gpgsign would prompt or fail here.
    await git(repo, "-c", "commit.gpgsign=false", "commit", "-m", "chore: starter");
  }

  // The hook goes in only after the starter commit, so that commit is never reported. It comes from
  // AgencyMem's starter, not the repository's copy, which a build run may edit.
  // ponytail: a machine-wide core.hooksPath would skip this hook; set it locally if that ever bites.
  const hook = join(repo, ".git", "hooks", "post-commit");
  await mkdir(join(repo, ".git", "hooks"), { recursive: true });
  await copyFile(join(STARTER, ".githooks", "post-commit"), hook);
  await chmod(hook, 0o755);
  await git(repo, "config", "agencymem.projectId", projectId);

  const exclude = join(repo, ".git", "info", "exclude");
  await mkdir(join(repo, ".git", "info"), { recursive: true });
  const listed = existsSync(exclude) ? (await readFile(exclude, "utf8")).split(/\r?\n/) : [];
  const missing = EXCLUDED.filter((name) => !listed.includes(name));
  if (missing.length) await appendFile(exclude, `\n${missing.join("\n")}\n`);
  return repo;
}

/**
 * Posts the commits the hook logged while the gateway was down (contracts.md section 9). The log is
 * first renamed, so a hook that appends meanwhile (this worker's or another's in the same project)
 * starts a fresh one; lines to try again are appended back. Only a line the gateway can never take
 * (400 bad body, 404 unknown project) is dropped; anything else, a wrong token (401) included, is
 * kept, so a config mistake loses no commit.
 */
export async function replayPending(
  repo: string,
  gw: { gatewayUrl: string; hookToken: string },
): Promise<{ sent: number; kept: number }> {
  const log = join(repo, ".git", "am-pending.log");
  const replaying = `${log}.replaying`; // also what a crashed replay left behind
  if (existsSync(log)) {
    // rename is atomic: a hook appending now starts a fresh log instead of losing its line.
    const taken = `${log}.${process.pid}`;
    await rename(log, taken);
    await appendFile(replaying, await readFile(taken, "utf8"));
    await rm(taken, { force: true });
  }
  if (!existsSync(replaying)) return { sent: 0, kept: 0 };
  const lines = (await readFile(replaying, "utf8")).split(/\r?\n/).filter((l) => l.trim());
  const kept: string[] = [];
  let sent = 0;
  for (const line of lines) {
    const status = await fetch(`${gw.gatewayUrl}/hooks/commit`, {
      method: "POST",
      headers: { "X-AM-Token": gw.hookToken, "Content-Type": "application/json" },
      body: line,
    }).then(
      (r) => r.status,
      () => 0, // unreachable
    );
    if (status >= 200 && status < 300) sent += 1;
    else if (status === 400 || status === 404) {
      console.warn(`runner: the gateway refused a logged commit for good (${status}); dropped`);
    } else kept.push(line);
  }
  if (kept.length > 0) await appendFile(log, `${kept.join("\n")}\n`);
  await rm(replaying, { force: true });
  return { sent, kept: kept.length };
}
