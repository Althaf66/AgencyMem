// Task 4.9, Done when: one TestRun per TestCase, tagged with the commit sha. The Test agent's
// test_run job through the real runner loop (runItem), against the real gateway and FalkorDB, on a
// real project repository: a build commit goes through the installed hook (T17 opens the item),
// the job runs the card's specs with the runner's own Playwright at that commit, and submits.
// It lives outside apps/, because the runner may not import the gateway (AGENTS.md rule 1).
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "@agencymem/contracts";
import { close, connect, readQuery, type FalkorDB } from "@agencymem/graph";
import type { ModelClient } from "@agencymem/llm";
import {
  createProject,
  deleteTestClient,
  setStage,
  writeCards,
  writeDocument,
  writeFacts,
  writeProduct,
  writeTests,
  writeVersioned,
  type Ctx,
} from "@agencymem/memory";
import { createGateway } from "../../apps/gateway/src/main";
import { testRunJob } from "../../apps/runner/src/agents/test/run-tests";
import { runItem } from "../../apps/runner/src/loop";
import { openSession } from "../../apps/runner/src/mcp-client";
import { ensureRepo } from "../../apps/runner/src/repo";

const run = promisify(execFile);
const TOKENS = { AM_AGENT_TOKEN: "agent-t", AM_UI_TOKEN: "ui-t", AM_HOOK_TOKEN: "hook-t" };
const FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";
// Built at run time, so this file holds no Cypher string literal (AGENTS.md rule 4).
const q = (...parts: string[]) => parts.join(" ");
// The runner's own @playwright/test stands in for npm ci: no network. Linked at its real path, so
// Node finds its dependencies next to it in the pnpm store.
const PLAYWRIGHT = realpathSync(
  fileURLToPath(new URL("../../apps/runner/node_modules/@playwright/test", import.meta.url)),
);

let db: FalkorDB;
let server: Server;
let base: string;
let ctx: Ctx;
let repo: string;
const graphs = new Set<string>();
const workspaces = mkdtempSync(join(tmpdir(), "am-ws-"));
const link = () => join(repo, "node_modules", "@playwright", "test");

beforeAll(async () => {
  db = await connect(FALKORDB_URL);
  server = createGateway(loadConfig({ ...TOKENS, FALKORDB_URL }, "gateway"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  if (repo && existsSync(link())) unlinkSync(link()); // the link only, never the runner's install
  rmSync(workspaces, { recursive: true, force: true });
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  for (const graph of graphs) await deleteTestClient(db, graph);
  await close();
});

/** CARD-01 with two criteria and their TestCases (Ready), in a project in build. */
async function oneCard(): Promise<{ taskId: string; testCaseIds: string[] }> {
  const now = Date.now();
  const { project, client } = await createProject(db, {
    clientName: `test-client-${randomUUID()}`,
    projectName: "Test runner",
    mode: "demo",
    createdBy: "human:test",
    now,
  });
  ctx = { db, graph: `client_${client.id}`, projectId: project.id };
  graphs.add(ctx.graph);
  await setStage(db, project.id, "intake", "build");
  const { episodeIds } = await writeDocument(ctx, {
    name: "notes.pdf",
    mime: "application/pdf",
    sha256: "9".repeat(64),
    status: "processed",
    wordCount: 3,
    error: null,
    episodes: [{ page: 1, lineStart: 1, lineEnd: 1, text: "One rule." }],
    createdBy: "human:test",
    now,
  });
  const { factIds } = await writeFacts(ctx, {
    entities: [{ key: "clinic", name: "Clinic", aliases: [] }],
    facts: [
      {
        statement: "Rule 1 is A.",
        subject: "clinic",
        attribute: "rule_1",
        value: "A",
        episodeIds,
        replacesFactId: null,
      },
    ],
    createdBy: "intake",
    now,
  });
  await writeProduct(ctx, {
    baseVersion: 0,
    requirements: [{ key: "REQ-01", text: "A patient can book.", priority: "must", factIds }],
    features: [
      {
        key: "FEAT-01",
        name: "Booking",
        featureKind: "form",
        requirementKeys: ["REQ-01"],
        estimate: { rawHours: 4, hours: 4, basis: "raw 4 h, no lesson = 4 h", lessonIds: [] },
      },
    ],
    createdBy: "proposal",
    now,
  });
  const { taskIds } = (await writeCards(ctx, {
    cards: [
      {
        key: "CARD-01",
        title: "Book",
        description: "The booking form.",
        lane: "Backend",
        order: 10,
        requirementKey: "REQ-01",
        designKeys: [],
        dependsOn: [],
        criteria: [1, 2].map((i) => ({
          key: `AC-01-${i}`,
          text: `Given ${i}, then it works.`,
          testIds: [],
        })),
      },
    ] as never,
    createdBy: "planner",
    now,
  }))!;
  const written = await writeTests(ctx, {
    taskId: taskIds[0]!,
    cases: [1, 2].map((i) => ({
      criterionKey: `AC-01-${i}`,
      file: `tests/e2e/CARD-01/AC-01-${i}.spec.ts`,
      title: `AC-01-${i}: t`,
    })),
    createdBy: "test",
    now,
  });
  return { taskId: taskIds[0]!, testCaseIds: written!.testCaseIds };
}

const spec = (title: string, body: string) =>
  `import { expect, test } from "@playwright/test";\n\ntest("${title}", () => {\n  ${body}\n});\n`;

describe("Done when: one TestRun per TestCase, tagged with the commit sha", () => {
  it(
    "runs the card's specs at the build commit and records one run per TestCase",
    { timeout: 180_000 },
    async () => {
      const { taskId, testCaseIds } = await oneCard();
      repo = await ensureRepo(ctx.projectId, { workspacesDir: workspaces, install: false });
      mkdirSync(join(repo, "node_modules", "@playwright"), { recursive: true });
      symlinkSync(PLAYWRIGHT, link(), "junction");
      const hook = { GATEWAY_URL: base, AM_HOOK_TOKEN: "hook-t" };
      const git = async (env: Record<string, string>, ...args: string[]) =>
        (
          await run("git", ["-c", "commit.gpgsign=false", ...args], {
            cwd: repo,
            env: { ...process.env, ...env },
          })
        ).stdout.trim();

      // The Test agent's commit: the specs (one passes, one fails), and a Playwright config without
      // the dev server, which would need the sample app's own npm ci.
      await git({}, "checkout", "-b", "card/CARD-01");
      writeFileSync(
        join(repo, "playwright.config.ts"),
        'import { defineConfig } from "@playwright/test";\n\nexport default defineConfig({\n' +
          '  testDir: "tests/e2e",\n  reporter: [["json", { outputFile: "test-results/report.json" }]],\n});\n',
      );
      mkdirSync(join(repo, "tests", "e2e", "CARD-01"), { recursive: true });
      writeFileSync(
        join(repo, "tests/e2e/CARD-01/AC-01-1.spec.ts"),
        spec("AC-01-1: works", "expect(1 + 1).toBe(2);"),
      );
      writeFileSync(
        join(repo, "tests/e2e/CARD-01/AC-01-2.spec.ts"),
        spec("AC-01-2: works", "expect(2 + 2).toBe(5);"),
      );
      await git({}, "add", "-A");
      await git(
        { ...hook, GIT_AUTHOR_NAME: "agencymem-test" },
        "commit",
        "-m",
        "test(CARD-01): specs",
      );

      // The build run's commit, through the hook: the card goes to Testing and a test_run item opens.
      const [row] = await readQuery<{ n: { properties: { version: number } } }>(
        db,
        ctx.graph,
        "read/node",
        { id: taskId },
      );
      await writeVersioned(ctx, {
        id: taskId,
        version: row!.n.properties.version,
        props: { column: "In progress" },
      });
      writeFileSync(join(repo, "README.md"), "Built by AgencyMem.\n");
      await git({}, "add", "README.md");
      await git(hook, "commit", "-m", "feat(CARD-01): book");
      const sha = await git({}, "rev-parse", "HEAD");

      const session = await openSession(
        { gatewayUrl: base, token: "agent-t" },
        { agent: "test", projectId: ctx.projectId, workerId: "test-run-1" },
      );
      try {
        const job = testRunJob({ workspacesDir: workspaces });
        expect(await runItem(job, session, {} as ModelClient, { heartbeatMs: 60_000 })).toBe(
          "done",
        );
      } finally {
        await session.close();
      }

      const res = await fetch(`${base}/api/query`, {
        method: "POST",
        headers: {
          "X-AM-Token": "ui-t",
          "X-AM-Actor": "human:ana",
          "Content-Type": "application/json",
          "X-AM-Project": ctx.projectId,
        },
        body: JSON.stringify({
          graph: "client",
          cypher: q(
            "MATCH",
            "(r:TestRun)-[:RUNS]->(c:TestCase)",
            "RETURN",
            "c.id, r.sha, r.passed, r.error ORDER BY c.file",
          ),
        }),
      });
      const rows = ((await res.json()) as { rows: [string, string, boolean, string | null][] })
        .rows;
      expect(rows.map(([id, runSha, passed]) => [id, runSha, passed])).toEqual([
        [testCaseIds[0], sha, true],
        [testCaseIds[1], sha, false],
      ]);
      expect(rows[1]![3]).toContain("Expected: 5");
      expect(
        (
          await readQuery<{ n: { properties: Record<string, unknown> } }>(
            db,
            ctx.graph,
            "read/node",
            { id: taskId },
          )
        )[0]!.n.properties,
      ).toMatchObject({ column: "In progress", note: "Tests failed: AC-01-2" });
      // The run worktree is gone.
      expect(existsSync(join(workspaces, ctx.projectId, "run", sha))).toBe(false);
    },
  );
});
