// The Launch job against a real git repository (agent-prompts.md section 10): drift reads main
// without its merge commits and without the unreported root starter commit.
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ReadinessCheck } from "@agencymem/contracts";
import type { Act, Recall } from "../../agent";
import { ensureRepo } from "../../repo";
import { launchJob } from "./agent";

const run = promisify(execFile);
const workspaces = mkdtempSync(join(tmpdir(), "am-launch-"));
const noHooks = mkdtempSync(join(tmpdir(), "am-nohooks-")); // a commit here reaches no gateway
afterAll(() => {
  rmSync(workspaces, { recursive: true, force: true });
  rmSync(noHooks, { recursive: true, force: true });
});
const PID = "01JA00000000000000000000P5";
const git = async (cwd: string, ...args: string[]) =>
  (
    await run("git", ["-c", "commit.gpgsign=false", "-c", `core.hooksPath=${noHooks}`, ...args], {
      cwd,
    })
  ).stdout.trim();

const graphChecks: ReadinessCheck[] = ["cards_done", "coverage", "open_assumptions"].map(
  (name) => ({ name, passed: true, detail: "none", nodeIds: [] }) as ReadinessCheck,
);

function launch(changes: { id: string; sha: string; linked: boolean }[]) {
  const recall = {
    item: { id: "01JA00000000000000000000W1" },
    project: { id: PID },
    context: { readiness: graphChecks, codeChanges: changes },
  } as unknown as Recall;
  const call = vi.fn(async () => ({ itemId: "01JA00000000000000000000W1", reportId: "R1" }));
  const act = { call, say: vi.fn(async () => undefined) } as unknown as Act;
  return { run: () => launchJob({ workspacesDir: workspaces }).run(recall, act), call };
}
const drift = (call: ReturnType<typeof launch>["call"]) =>
  (call.mock.calls[0] as unknown as [string, { report: { checks: ReadinessCheck[] } }])[1].report
    .checks[3]!;

describe("launchJob", { timeout: 30_000 }, () => {
  it("fails drift on a commit on main with no CodeChange, skipping the root and merge commits", async () => {
    const repo = await ensureRepo(PID, { workspacesDir: workspaces, install: false });
    const root = await git(repo, "rev-parse", "HEAD");
    await git(repo, "checkout", "-q", "-b", "card/CARD-01");
    writeFileSync(join(repo, "a.txt"), "a");
    await git(repo, "add", "a.txt");
    await git(repo, "commit", "-q", "-m", "feat(CARD-01): a");
    const card = await git(repo, "rev-parse", "HEAD");
    await git(repo, "checkout", "-q", "main");
    await git(repo, "merge", "-q", "--no-ff", "-m", "Merge card/CARD-01", "card/CARD-01");
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "b.txt"), "b");
    await git(repo, "add", "-A");
    await git(repo, "commit", "-q", "-m", "chore: by hand on main");
    const stray = await git(repo, "rev-parse", "HEAD");

    const recorded = launch([{ id: "CC1", sha: card, linked: true }]);
    const { summary } = await recorded.run();
    expect(summary).toBe("Readiness: 3 of 4 checks passed");
    const check = drift(recorded.call);
    expect(check).toMatchObject({ name: "drift", passed: false, nodeIds: [] });
    expect(check.detail).toContain(stray.slice(0, 7));
    expect(check.detail).not.toContain(root.slice(0, 7));
    expect(check.detail).toMatch(/^1 commit not recorded/);

    const all = launch([
      { id: "CC1", sha: card, linked: true },
      { id: "CC2", sha: stray, linked: true },
    ]);
    await all.run();
    expect(drift(all.call)).toMatchObject({
      passed: true,
      detail: "All 2 commits on main are recorded",
    });
  });

  it("fails the item when the project repository is missing, instead of making a fresh one", async () => {
    const recall = {
      item: { id: "01JA00000000000000000000W2" },
      project: { id: "01JA00000000000000000000P6" },
      context: { readiness: graphChecks, codeChanges: [] },
    } as unknown as Recall;
    const act = { call: vi.fn(), say: vi.fn() } as unknown as Act;
    await expect(launchJob({ workspacesDir: workspaces }).run(recall, act)).rejects.toThrow(
      "The project repository is missing",
    );
  });
});
