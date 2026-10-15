// The Test agent's write_tests job (agent-prompts.md section 7): one Playwright spec per acceptance
// criterion, written in a wt-test worktree on branch card/<key>, checked with `playwright test
// --list`, committed as agencymem-test, and recorded with write_tests. The --list check runs in
// check(), so a file that does not parse or holds the wrong number of tests gets the model's one
// repair.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { Context } from "@agencymem/contracts";
import { loadPrompt, type Agent, type Recall } from "../../agent";
import { ensureRepo } from "../../repo";
import { WriteTestsOutput } from "./output";

const run = promisify(execFile);
const TESTIDS = await readFile(new URL("../testids.md", import.meta.url), "utf8");
const PROMPT = `${await loadPrompt(import.meta.url, "Test")}\n${TESTIDS}`;
const TITLE_MAX = 200; // TestCase.title (contracts.md section 4)
/** The link itself, even when its target is gone (existsSync follows it). */
const present = (path: string) =>
  lstat(path).then(
    () => true,
    () => false,
  );

type Card = Pick<NonNullable<Context["tasks"]>[number], "key" | "criteria">;

/** The file of a criterion: tests/e2e/<CARD key>/<AC key>.spec.ts. */
const specPath = (cardKey: string, criterionKey: string) =>
  `tests/e2e/${cardKey}/${criterionKey}.spec.ts`;

/** Reference errors in the files the model wrote, before anything touches the disk. */
export function checkFiles(output: WriteTestsOutput, card: Card): string[] {
  const criteria = new Set(card.criteria.map((k) => k.key));
  const errors: string[] = [];
  output.files.forEach((f, i) => {
    if (!criteria.has(f.criterionKey)) {
      errors.push(`files.${i}.criterionKey: ${f.criterionKey} is not a criterion of ${card.key}`);
    } else if (f.path !== specPath(card.key, f.criterionKey)) {
      errors.push(`files.${i}.path: must be ${specPath(card.key, f.criterionKey)}`);
    }
  });
  for (const key of criteria) {
    const n = output.files.filter((f) => f.criterionKey === key).length;
    if (n > 1) errors.push(`files: ${key} has ${n} files; write exactly one`);
    if (n === 0) errors.push(`files: ${key} has no file`);
  }
  return errors;
}

type Suite = { file?: string; specs?: { title: string }[]; suites?: Suite[] };
type ListReport = { suites?: Suite[]; errors?: { message?: string }[] };

/**
 * The test titles per spec file from `playwright test --list --reporter=json`, and an error for
 * each file that does not list exactly one test. Report files are relative to tests/e2e.
 */
export function listedTests(
  report: ListReport,
  paths: string[],
): { errors: string[]; titles: Map<string, string> } {
  const failed = (report.errors ?? []).map((e) => `playwright test --list: ${e.message ?? ""}`);
  if (failed.length) return { errors: failed.map((e) => e.slice(0, 1000)), titles: new Map() };
  const found = new Map<string, string[]>();
  const walk = (suite: Suite, file: string) => {
    for (const spec of suite.specs ?? []) found.get(file)!.push(spec.title);
    for (const child of suite.suites ?? []) walk(child, file);
  };
  for (const top of report.suites ?? []) {
    const file = `tests/e2e/${top.file ?? ""}`;
    found.set(file, []);
    walk(top, file);
  }
  const errors: string[] = [];
  const titles = new Map<string, string>();
  for (const path of paths) {
    const listed = found.get(path) ?? [];
    if (listed.length !== 1) {
      errors.push(`${path}: lists ${listed.length} tests; it must list exactly one`);
    } else {
      titles.set(path, listed[0]!);
    }
  }
  return { errors, titles };
}

export type TestsOptions = {
  workspacesDir: string;
  /** For the post-commit hook, which reports each commit to the gateway. */
  gatewayUrl: string;
  hookToken: string;
  /** false skips npm ci in a new repository (tests). */
  install?: boolean;
};

export function writeTestsAgent(opts: TestsOptions): Agent<WriteTestsOutput> {
  const git = (cwd: string, args: string[], env: Record<string, string> = {}) =>
    run("git", args, { cwd, env: { ...process.env, ...env } });
  /** The titles --list read, per item, from check() to act(). */
  const listed = new Map<string, Map<string, string>>();

  const card = (recall: Recall) => recall.context.tasks![0]!;
  const paths = (repo: string, cardKey: string) => {
    const tree = join(dirname(repo), "wt-test", cardKey);
    return { tree, link: join(tree, "node_modules"), branch: `card/${cardKey}` };
  };

  /** The worktree on card/<key> (made from main when the branch is new), with node_modules. */
  async function worktree(repo: string, cardKey: string): Promise<string> {
    const { tree, link, branch } = paths(repo, cardKey);
    if (!existsSync(join(tree, ".git"))) {
      await git(repo, ["worktree", "prune"]);
      const exists = await git(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])
        .then(() => true)
        .catch(() => false);
      await git(repo, [
        "worktree",
        "add",
        ...(exists ? [tree, branch] : ["-b", branch, tree, "main"]),
      ]);
    }
    // The repository's install (sample-app.md section 10). A link, so nothing is copied.
    if (!(await present(link)) && existsSync(join(repo, "node_modules"))) {
      await symlink(join(repo, "node_modules"), link, "junction");
    }
    return tree;
  }

  async function list(tree: string, cardKey: string, files: string[]) {
    const cli = join(tree, "node_modules", "@playwright", "test", "cli.js");
    const args = [cli, "test", "--list", "--reporter=json", `tests/e2e/${cardKey}`];
    // A file that does not parse exits non-zero, but the JSON report still names the error.
    const stdout = await run(process.execPath, args, { cwd: tree, maxBuffer: 10_000_000 }).then(
      (r) => r.stdout,
      (e: { stdout?: string; message: string }) =>
        e.stdout || JSON.stringify({ errors: [{ message: e.message }] }),
    );
    let report: ListReport;
    try {
      report = JSON.parse(stdout) as ListReport;
    } catch {
      report = { errors: [{ message: stdout }] };
    }
    return listedTests(report, files);
  }

  return {
    id: "test",
    kinds: ["write_tests"],
    tier: "deep",
    maxTokens: 8000, // agent-prompts.md section 1: up to three whole spec files
    task: "Write one Playwright spec file for each acceptance criterion.",
    prompt: PROMPT,
    output: WriteTestsOutput,
    handoff: [],
    select: (recall) => ({
      tasks: recall.context.tasks ?? [],
      design: recall.context.design ?? [],
      facts: recall.context.facts ?? [],
    }),
    async check(output, recall) {
      const errors = checkFiles(output, card(recall));
      if (errors.length) return errors;
      const { key } = card(recall);
      const repo = await ensureRepo(recall.project.id, opts);
      const tree = await worktree(repo, key);
      await rm(join(tree, "tests", "e2e", key), { recursive: true, force: true });
      await mkdir(join(tree, "tests", "e2e", key), { recursive: true });
      for (const f of output.files) await writeFile(join(tree, f.path), f.content);
      const result = await list(
        tree,
        key,
        output.files.map((f) => f.path),
      );
      if (result.errors.length === 0) listed.set(recall.item.id, result.titles);
      return result.errors;
    },
    async act(output, recall, act) {
      const { id, key } = card(recall);
      const repo = await ensureRepo(recall.project.id, opts);
      const { tree, link } = paths(repo, key);
      await git(tree, ["add", "--", `tests/e2e/${key}`]);
      const staged = await git(tree, ["diff", "--cached", "--quiet"]).then(
        () => false,
        () => true,
      );
      const criteria = output.files.map((f) => f.criterionKey).join(", ");
      if (staged) {
        // An earlier attempt may have committed these specs already; then HEAD is that commit.
        await git(
          tree,
          [
            "-c",
            "user.name=agencymem-test",
            "-c",
            "user.email=test@agencymem.local",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-m",
            `test(${key}): specs for ${criteria}`,
          ],
          { GATEWAY_URL: opts.gatewayUrl, AM_HOOK_TOKEN: opts.hookToken },
        );
      }
      const sha = (await git(tree, ["rev-parse", "HEAD"])).stdout.trim();
      const titles = listed.get(recall.item.id) ?? new Map<string, string>();
      listed.delete(recall.item.id);
      const written = await act.call("write_tests", {
        itemId: recall.item.id,
        taskId: id,
        sha,
        cases: output.files.map((f) => ({
          criterionKey: f.criterionKey,
          file: f.path,
          // ponytail: "<AC key>: <criterion text>" can pass TestCase's 200; the stored title is cut.
          title: (titles.get(f.path) ?? f.criterionKey).slice(0, TITLE_MAX),
        })),
      });
      // The link goes first, so removing the worktree never reaches into the repository's install.
      if (await present(link)) await unlink(link);
      await git(repo, ["worktree", "remove", "--force", tree]);
      const summary = `Specs for ${criteria} on card/${key} (${sha.slice(0, 7)}); ${key} is ${written.taskColumn}`;
      await act.say(summary);
      return { outputIds: written.testCaseIds, summary };
    },
  };
}
