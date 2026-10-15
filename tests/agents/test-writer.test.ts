// Task 3.8, Done when: every criterion has at least one TestCase before any build starts. Set A
// runs to the Planner's cards on recorded replies; the Test agent writes one spec per criterion in
// a worktree of the project's repository, checks it with `playwright test --list`, commits it on
// card/<key> as agencymem-test, and records it with write_tests.
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProjectInfo } from "@agencymem/contracts";
import { architect } from "../../apps/runner/src/agents/architect/agent";
import { discovery } from "../../apps/runner/src/agents/discovery/agent";
import { intake } from "../../apps/runner/src/agents/intake/agent";
import { planner } from "../../apps/runner/src/agents/planner/agent";
import { proposal } from "../../apps/runner/src/agents/proposal/agent";
import { writeTestsAgent } from "../../apps/runner/src/agents/test/write-tests";
import { ensureRepo } from "../../apps/runner/src/repo";
import { OWN_A, startHarness, ui, type Harness } from "./harness";

// Built at run time, so this file holds no Cypher string literal (AGENTS.md rule 4).
const q = (...parts: string[]) => parts.join(" ");
const run = promisify(execFile);
const git = async (cwd: string, ...args: string[]) =>
  (await run("git", args, { cwd })).stdout.trim();
// The runner's own @playwright/test (contracts.md section 11) stands in for npm ci: no network.
// Linked at its real path, so Node finds its dependencies next to it in the pnpm store.
const PLAYWRIGHT = realpathSync(
  fileURLToPath(new URL("../../apps/runner/node_modules/@playwright/test", import.meta.url)),
);

let h: Harness;
let project: ProjectInfo;
let repo: string;
const link = () => join(repo, "node_modules", "@playwright", "test");
const workspaces = mkdtempSync(join(tmpdir(), "am-ws-"));

beforeAll(async () => {
  h = await startHarness();
  project = await h.project("A");
  await h.run(intake, "intake-A.json", project.id, 3);
  await h.run(discovery, "discovery-A.json", project.id, 1);
  await h.answerAndApprove(project.id, OWN_A);
  await h.run(intake, "intake-answer-A.json", project.id, 15);
  await h.run(proposal, "proposal-A.json", project.id, 1);
  await h.decide(project.id, "G2", "approve", `persona:${project.id}`);
  await h.run(architect, "architect-A.json", project.id, 1);
  await h.decide(project.id, "G3", "approve", "human:lead");
  await h.run(planner, "planner-A.json", project.id, 1);

  repo = await ensureRepo(project.id, { workspacesDir: workspaces, install: false });
  mkdirSync(join(repo, "node_modules", "@playwright"), { recursive: true });
  symlinkSync(PLAYWRIGHT, link(), "junction");
  const tester = writeTestsAgent({
    workspacesDir: workspaces,
    gatewayUrl: h.base,
    hookToken: "hook-t",
    install: false,
  });
  await h.run(tester, "test-A.json", project.id, 10);
}, 300_000); // the whole chain from upload to the specs of ten cards
afterAll(async () => {
  unlinkSync(link()); // the link only, never the runner's install
  rmSync(workspaces, { recursive: true, force: true });
  await h.stop();
});

describe("Done when: every criterion has at least one TestCase before any build starts", () => {
  it("verifies every acceptance criterion with a TestCase", async () => {
    const criteria = await h.rows(
      project.id,
      q(
        "MATCH",
        "(k:AcceptanceCriterion)",
        "OPTIONAL MATCH",
        "(k)<-[:VERIFIES]-(x:TestCase)",
        "RETURN",
        "k.key, count(x), collect(x.file)",
        "ORDER BY",
        "k.key",
      ),
    );
    expect(criteria).toHaveLength(16);
    for (const [key, cases, files] of criteria as [string, number, string[]][]) {
      expect(cases).toBe(1);
      expect(files[0]).toBe(`tests/e2e/CARD-${key.split("-")[1]}/${key}.spec.ts`);
    }
  });

  it("moves every card to Ready, none further, and the project to build (T16)", async () => {
    const columns = await h.rows(
      project.id,
      q("MATCH", "(t:Task)", "RETURN", "t.column, count(t)"),
    );
    expect(columns).toEqual([["Ready", 10]]);
    const res = await fetch(`${h.base}/api/projects/${project.id}`, { headers: ui });
    expect(((await res.json()) as { project: ProjectInfo }).project.stage).toBe("build");
    expect(
      await h.rows(
        project.id,
        q("MATCH", "(w:WorkItem {kind: 'write_tests'})", "RETURN", "w.status, count(w)"),
      ),
    ).toEqual([["done", 10]]);
  });

  it("commits the specs of each card on card/<key> as agencymem-test, and leaves main and no worktree", async () => {
    expect(await git(repo, "rev-list", "--count", "main")).toBe("1");
    for (let n = 1; n <= 10; n++) {
      const key = `CARD-${String(n).padStart(2, "0")}`;
      const branch = `card/${key}`;
      expect(await git(repo, "log", "-1", "--format=%an|%s", branch)).toMatch(
        new RegExp(`^agencymem-test\\|test\\(${key}\\): specs for AC-`),
      );
      const files = (await git(repo, "diff", "--name-only", `main..${branch}`)).split("\n");
      expect(files.every((f) => f.startsWith(`tests/e2e/${key}/`) && f.endsWith(".spec.ts"))).toBe(
        true,
      );
    }
    expect((await git(repo, "worktree", "list")).split("\n")).toHaveLength(1);
  });
});
