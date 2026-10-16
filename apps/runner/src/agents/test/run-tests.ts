// The Test agent's test_run job (agent-prompts.md section 7, no model): run the card's Playwright
// specs at the commit in a temporary worktree and record one TestRun per TestCase with
// submit_test_run. A crash of Playwright itself (no JSON report) fails the item, not the tests.
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, readFile, rm, symlink, unlink } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { promisify, stripVTControlCharacters } from "node:util";
import { JobFailed, type ActResult, type Job } from "../../agent";
import { ensureRepo } from "../../repo";

const run = promisify(execFile);
const git = (cwd: string, ...args: string[]) => run("git", args, { cwd });
const ERROR_MAX = 500; // TestRun.error

/** A port nobody listens on now: each run's dev server gets its own (sample-app.md section 4). */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

export type Spec = {
  file: string;
  ok: boolean;
  tests: { results: { duration: number; error?: { message?: string } }[] }[];
};
export type Suite = { specs?: Spec[]; suites?: Suite[] };

/** Every spec in Playwright's JSON report. */
function specsOf(suite: Suite): Spec[] {
  return [...(suite.specs ?? []), ...(suite.suites ?? []).flatMap(specsOf)];
}

/** One result per TestCase, from the specs of its file. A file with no result has failed. */
export function resultsFor(
  testCases: { id: string; file: string }[],
  report: { suites?: Suite[] },
) {
  const specs = (report.suites ?? []).flatMap(specsOf);
  return testCases.map((tc) => {
    // Playwright names files from its testDir (CARD-01/AC-01-1.spec.ts); TestCases from the repo.
    const mine = specs.filter((s) =>
      tc.file.replaceAll("\\", "/").endsWith(s.file.replaceAll("\\", "/")),
    );
    const results = mine.flatMap((s) => s.tests.flatMap((t) => t.results));
    const failure = results.find((r) => r.error?.message)?.error?.message;
    return {
      testCaseId: tc.id,
      passed: mine.length > 0 && mine.every((s) => s.ok),
      durationMs: Math.round(results.reduce((n, r) => n + r.duration, 0)),
      ...(mine.length === 0
        ? { error: "No result for this file." }
        : failure
          ? { error: stripVTControlCharacters(failure).slice(0, ERROR_MAX) } // no ANSI colours
          : {}),
    };
  });
}

/** Playwright's own timeouts are per test; this bounds the whole run, dev server included. */
// ponytail: a constant; make it config if a project's suite needs longer.
const RUN_TIMEOUT_MS = 10 * 60_000;
const win = process.platform === "win32";

/**
 * Runs Playwright and waits for it, stopping it (and the dev server it started) on a timeout or
 * when `stop()` turns true. Resolves either way; the report tells what happened.
 */
function playwright(cli: string, specs: string, tree: string, port: string, stop: () => boolean) {
  return new Promise<void>((resolve) => {
    const child = spawn(process.execPath, [cli, "test", specs], {
      cwd: tree,
      env: { ...process.env, PORT: port },
      stdio: "ignore",
      detached: !win, // its own process group on POSIX, so the kill reaches the dev server
    });
    const killTree = () => {
      if (!child.pid || child.exitCode !== null) return;
      // taskkill /T ends the tree on Windows, where a kill would leave npm run dev holding the port.
      if (win)
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]).on("error", () => child.kill());
      else {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // the group is already gone
        }
      }
    };
    const timer = setTimeout(killTree, RUN_TIMEOUT_MS);
    const watch = setInterval(() => stop() && killTree(), 1000);
    const done = () => {
      clearTimeout(timer);
      clearInterval(watch);
      resolve();
    };
    child.on("exit", done);
    child.on("error", done); // node itself did not start: no report, so the item fails
  });
}

/** A setup step's failure is the item's failure (with a note), not a gateway outage. */
export async function step<T>(what: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    throw new JobFailed(
      `${what} failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 900),
    );
  }
}

/**
 * Runs the Playwright specs under `specs` at `sha` in a temporary worktree next to the repository
 * and returns Playwright's JSON report. Used by test_run (one card) and e2e (every spec on main).
 */
export async function runSpecs(opts: {
  repo: string;
  sha: string;
  specs: string;
  lost: () => boolean;
}): Promise<{ suites?: Suite[] }> {
  const { repo, sha } = opts;
  const tree = join(dirname(repo), "run", sha);
  const link = join(tree, "node_modules");
  try {
    await step("The worktree", async () => {
      // A run that crashed left its worktree: start again from the commit.
      await rm(tree, { recursive: true, force: true });
      await git(repo, "worktree", "prune");
      await git(repo, "worktree", "add", "--detach", tree, sha);
    });
    await step("The install", async () => {
      // The repository's install when the commit kept main's packages; else its own (npm ci).
      const samePackages = await git(
        repo,
        "diff",
        "--quiet",
        "main",
        sha,
        "--",
        "package.json",
        "package-lock.json",
      ).then(
        () => true,
        () => false,
      );
      if (samePackages && existsSync(join(repo, "node_modules"))) {
        await symlink(join(repo, "node_modules"), link, "junction"); // no admin rights needed
      } else {
        await run("npm", ["ci", "--prefer-offline", "--no-audit", "--no-fund"], {
          cwd: tree,
          shell: win,
        });
      }
    });

    const port = String(await freePort());
    const cli = join(tree, "node_modules", "@playwright", "test", "cli.js");
    // A failing test exits non-zero; the report says which. Only a missing report is a crash.
    await playwright(cli, opts.specs, tree, port, opts.lost);
    // The lease went to another worker: it runs the tests again, so this run writes nothing.
    if (opts.lost()) throw new JobFailed("The lease ended during the run.");
    const reportFile = join(tree, "test-results", "report.json");
    if (!existsSync(reportFile))
      throw new JobFailed("Playwright crashed or timed out: it wrote no report.");
    return JSON.parse(await readFile(reportFile, "utf8")) as { suites?: Suite[] };
  } finally {
    // The link goes first, so removing the worktree never reaches into the repository's install.
    // A cleanup error must not hide the run's own result.
    if ((await lstat(link).catch(() => null))?.isSymbolicLink())
      await unlink(link).catch(() => undefined);
    await git(repo, "worktree", "remove", "--force", tree).catch(() => undefined);
    await git(repo, "worktree", "prune").catch(() => undefined);
  }
}

export function testRunJob(opts: { workspacesDir: string }): Job {
  return {
    id: "test",
    worker: "test-run-1", // the write_tests loop is test-1, the e2e loop test-e2e-1
    kinds: ["test_run"],
    handoff: [],
    async run(recall, act): Promise<ActResult> {
      const change = recall.context.codeChanges?.[0];
      const card = recall.context.tasks?.[0];
      if (!change || !card) throw new JobFailed("The commit is not linked to a card.");
      const repo = await step("The repository", () =>
        ensureRepo(recall.project.id, { workspacesDir: opts.workspacesDir }),
      );
      await act.say(
        `Running ${card.testCases.length} specs of ${card.key} at ${change.sha.slice(0, 7)}`,
      );
      const report = await runSpecs({
        repo,
        sha: change.sha,
        specs: `tests/e2e/${card.key}`,
        lost: () => act.lost?.() ?? false,
      });
      const results = resultsFor(card.testCases, report);
      const { testRunIds, taskColumn } = await act.call("submit_test_run", {
        itemId: recall.item.id,
        sha: change.sha,
        taskId: card.id,
        results,
      });
      const passed = results.filter((r) => r.passed).length;
      const summary = `${passed} of ${results.length} tests passed for ${card.key} at ${change.sha.slice(0, 7)}; ${card.key} is ${taskColumn}`;
      await act.say(summary);
      return { outputIds: testRunIds, summary };
    },
  };
}
