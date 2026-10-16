// Task 4.11, Done when: a forced conflict returns the card (to Ready: contracts C6 and
// stage-machine.md section 6 win over the plan row's "In progress"). The runner's merge job through
// the real runner loop (runItem), against the real gateway and FalkorDB, on a real project
// repository. It lives outside apps/, because the runner may not import the gateway (AGENTS.md rule 1).
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "@agencymem/contracts";
import { close, connect, readQuery, type FalkorDB } from "@agencymem/graph";
import type { ModelClient } from "@agencymem/llm";
import {
  createProject,
  deleteTestClient,
  openItem,
  setStage,
  writeCards,
  writeDocument,
  writeFacts,
  writeProduct,
  writeVersioned,
  type Ctx,
} from "@agencymem/memory";
import { createGateway } from "../../apps/gateway/src/main";
import { runItem } from "../../apps/runner/src/loop";
import { openSession } from "../../apps/runner/src/mcp-client";
import { mergeJob } from "../../apps/runner/src/merge";
import { ensureRepo } from "../../apps/runner/src/repo";
import { ensureWorktree } from "../../apps/runner/src/worktree";

const run = promisify(execFile);
const TOKENS = { AM_AGENT_TOKEN: "agent-t", AM_UI_TOKEN: "ui-t", AM_HOOK_TOKEN: "hook-t" };
const FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";

let db: FalkorDB;
let server: Server;
let base: string;
const graphs = new Set<string>();
const workspaces = mkdtempSync(join(tmpdir(), "am-ws-"));

beforeAll(async () => {
  db = await connect(FALKORDB_URL);
  server = createGateway(loadConfig({ ...TOKENS, FALKORDB_URL }, "gateway"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  rmSync(workspaces, { recursive: true, force: true });
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  for (const graph of graphs) await deleteTestClient(db, graph);
  await close();
});

const node = async (ctx: Ctx, id: string) =>
  (
    await readQuery<{ n: { properties: Record<string, unknown> } }>(db, ctx.graph, "read/node", {
      id,
    })
  )[0]!.n.properties;

/** CARD-01 and CARD-02, both Done with an open merge item (CARD-01's first), in build. */
async function twoDoneCards() {
  const now = Date.now();
  const { project, client } = await createProject(db, {
    clientName: `test-client-${randomUUID()}`,
    projectName: "Merge",
    mode: "demo",
    createdBy: "human:test",
    now,
  });
  const ctx: Ctx = { db, graph: `client_${client.id}`, projectId: project.id };
  graphs.add(ctx.graph);
  await setStage(db, project.id, "intake", "build");
  const { episodeIds } = await writeDocument(ctx, {
    name: "notes.pdf",
    mime: "application/pdf",
    sha256: "8".repeat(64),
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
    cards: [1, 2].map((n) => ({
      key: `CARD-0${n}`,
      title: `Card ${n}`,
      description: "A card.",
      lane: "Backend",
      order: n * 10,
      requirementKey: "REQ-01",
      designKeys: [],
      dependsOn: [],
      criteria: [{ key: `AC-0${n}-1`, text: "Given 1, then it works.", testIds: [] }],
    })) as never,
    createdBy: "planner",
    now,
  }))!;
  const itemIds: string[] = [];
  for (const [i, id] of taskIds.entries()) {
    const version = (await node(ctx, id)).version as number;
    await writeVersioned(ctx, { id, version, props: { column: "Done" } });
    const item = await openItem(ctx, {
      kind: "merge",
      subjectId: id,
      createdBy: "build",
      now: now + i, // CARD-01's item is the older one, so it is claimed first
    });
    itemIds.push(item!.id);
  }
  return { ctx, taskIds, itemIds };
}

describe("Done when: a forced conflict returns the card", () => {
  it(
    "sends a conflicting card back to Ready with its files, and merges a clean one",
    { timeout: 60_000 },
    async () => {
      const { ctx, taskIds, itemIds } = await twoDoneCards();
      const repo = await ensureRepo(ctx.projectId, { workspacesDir: workspaces, install: false });
      const git = async (...args: string[]) =>
        (await run("git", ["-c", "commit.gpgsign=false", ...args], { cwd: repo })).stdout.trim();
      const commit = async (file: string, text: string) => {
        writeFileSync(join(repo, file), text);
        await git("add", file);
        await git("commit", "-m", `chore: ${file}`);
      };
      // CARD-01 and main both add notes.txt (a conflict); CARD-02 adds its own file (clean).
      await git("checkout", "-b", "card/CARD-01");
      await commit("notes.txt", "from the card\n");
      await git("checkout", "main");
      await git("checkout", "-b", "card/CARD-02");
      await commit("card-02.txt", "card 2\n");
      await git("checkout", "main");
      await commit("notes.txt", "from main\n");
      const opts = { workspacesDir: workspaces, install: false };
      const tree1 = await ensureWorktree(ctx.projectId, "CARD-01", opts);
      const tree2 = await ensureWorktree(ctx.projectId, "CARD-02", opts);

      const session = await openSession(
        { gatewayUrl: base, token: "agent-t" },
        { agent: "build", projectId: ctx.projectId, workerId: "merge-1" },
      );
      const job = mergeJob({ workspacesDir: workspaces });
      const once = () => runItem(job, session, {} as ModelClient, { heartbeatMs: 60_000 });
      try {
        expect(await once()).toBe("failed");
        expect(await once()).toBe("done");
        expect(await once()).toBe("idle");
        // A merge item ends only with its result, and a result fits its outcome.
        for (const args of [
          { outcome: "done" },
          { outcome: "failed", result: { mergedSha: "a".repeat(40) } },
        ] as const) {
          await expect(
            session.call("complete_item", { itemId: itemIds[1]!, runs: [], ...args }),
          ).rejects.toMatchObject({ rejection: { code: "VALIDATION_FAILED" } });
        }
      } finally {
        await session.close();
      }

      // C6: back to Ready with the files, no mergedSha, no attempt; the item is cancelled.
      const card1 = await node(ctx, taskIds[0]!);
      expect(card1).toMatchObject({
        column: "Ready",
        note: "Merge conflict: notes.txt",
        attempts: 0,
      });
      expect(card1.mergedSha ?? null).toBeNull();
      expect(await node(ctx, itemIds[0]!)).toMatchObject({ status: "cancelled", attempts: 0 });
      expect(existsSync(tree1)).toBe(true); // the next build run merges main into it

      // The clean card: a merge commit on main, its sha on the card, the worktree gone.
      const head = await git("rev-parse", "main");
      expect(await node(ctx, taskIds[1]!)).toMatchObject({ column: "Done", mergedSha: head });
      expect(await node(ctx, itemIds[1]!)).toMatchObject({ status: "done" });
      expect((await git("rev-list", "--parents", "-n", "1", "main")).split(" ")).toHaveLength(3);
      expect(existsSync(tree2)).toBe(false);
      // The conflict was aborted: main's checkout is clean.
      expect(await git("status", "--porcelain")).toBe("");
    },
  );
});
