// The evidence routes through the real gateway against the real FalkorDB and a real git repo in a
// temporary WORKSPACES_DIR. No mocks.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CommitDiffResponse, ItemRunsResponse, loadConfig } from "@agencymem/contracts";
import { close, connect, type FalkorDB } from "@agencymem/graph";
import {
  createProject,
  deleteTestClient,
  openItem,
  recordCommit,
  recordRecall,
  writeRun,
  type Ctx,
} from "@agencymem/memory";
import { createEvents } from "../events/bus";
import { createGateway } from "../main";
import { splitDiff } from "./evidence";

const TOKENS = { AM_AGENT_TOKEN: "agent-t", AM_UI_TOKEN: "ui-t", AM_HOOK_TOKEN: "hook-t" };
const FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";

let db: FalkorDB;
let server: Server;
let base: string;
let ctx: Ctx;
let sha: string;
let codeChangeId: string;
const workspaces = mkdtempSync(join(tmpdir(), "am-evidence-"));
const events = createEvents();

const get = async (path: string) => {
  const res = await fetch(`${base}${path}`, { headers: { "X-AM-Token": "ui-t" } });
  return { status: res.status, body: (await res.json()) as unknown };
};

beforeAll(async () => {
  db = await connect(FALKORDB_URL);
  server = createGateway(
    loadConfig({ ...TOKENS, FALKORDB_URL, WORKSPACES_DIR: workspaces }, "gateway"),
    { events },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const { project, client } = await createProject(db, {
    clientName: `test-client-${randomUUID()}`,
    projectName: "Evidence",
    mode: "demo",
    createdBy: "human:test",
    now: Date.now(),
  });
  ctx = { db, graph: `client_${client.id}`, projectId: project.id };
  // The project's repo with one commit that adds a file.
  const repo = join(workspaces, project.id, "repo");
  mkdirSync(repo, { recursive: true });
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo })
      .toString()
      .trim();
  git("init", "-q", "-b", "main");
  writeFileSync(join(repo, "hello.ts"), "export const hello = 1;\n");
  git("add", ".");
  git("commit", "-qm", "feat: hello");
  sha = git("rev-parse", "HEAD");
  ({
    codeChange: { id: codeChangeId },
  } = await recordCommit(ctx, {
    sha,
    branch: "main",
    files: ["hello.ts"],
    message: "feat: hello",
    author: "t",
    committedAt: Date.now(),
    now: Date.now(),
  }));
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await deleteTestClient(db, ctx.graph);
  await close();
  rmSync(workspaces, { recursive: true, force: true });
});

describe("evidence routes", () => {
  it("serves a project commit's diff, file by file", async () => {
    const { status, body } = await get(`/api/projects/${ctx.projectId}/commits/${sha}/diff`);
    expect(status).toBe(200);
    const diff = CommitDiffResponse.parse(body);
    expect(diff.files.map((f) => f.path)).toEqual(["hello.ts"]);
    expect(diff.files[0]!.patch).toContain("+export const hello = 1;");
    expect(diff.truncated).toBe(false);
  });

  it("refuses a bad sha, and a sha the project's graph does not hold", async () => {
    expect((await get(`/api/projects/${ctx.projectId}/commits/HEAD/diff`)).status).toBe(400);
    const other = "f".repeat(40);
    expect((await get(`/api/projects/${ctx.projectId}/commits/${other}/diff`)).status).toBe(404);
  });

  it("lists an item's model calls, and 404s an id that is not one of its items", async () => {
    const item = (await openItem(ctx, {
      kind: "planner",
      createdBy: "human:test",
      now: Date.now(),
    }))!;
    await writeRun(ctx, {
      itemId: item.id,
      agent: "planner",
      run: {
        step: "think",
        model: "m",
        endpoint: "primary",
        tokensIn: 5,
        tokensOut: 7,
        ms: 9,
        cost: 0,
      },
      now: Date.now(),
    });
    const { body } = await get(`/api/projects/${ctx.projectId}/items/${item.id}/runs`);
    expect(ItemRunsResponse.parse(body).runs).toMatchObject([{ step: "think", tokensIn: 5 }]);
    const unknown = `/api/projects/${ctx.projectId}/items/01JA00000000000000000000X1/runs`;
    expect((await get(unknown)).status).toBe(404);
  });

  it("records what an item read as RECALLED edges, once each, kept out of the graph view", async () => {
    const item = (await openItem(ctx, { kind: "architect", createdBy: "human:test", now: 1 }))!;
    const read = { itemId: item.id, agent: "architect" as const, ids: [codeChangeId], keys: [] };
    expect(await recordRecall(ctx, { ...read, now: 1 })).toEqual([codeChangeId]);
    expect(await recordRecall(ctx, { ...read, keys: ["NOPE"], now: 2 })).toEqual([codeChangeId]);
    const node = (await get(`/api/projects/${ctx.projectId}/nodes/${item.id}`)).body as {
      links: { type: string; otherId: string }[];
    };
    expect(node.links.filter((l) => l.type === "RECALLED")).toEqual([
      expect.objectContaining({ otherId: codeChangeId }),
    ]);
    const graph = (await get(`/api/projects/${ctx.projectId}/graph?focus=${item.id}`)).body as {
      nodes: { id: string }[];
      links: { type: string }[];
    };
    expect(graph.nodes.map((n) => n.id)).toEqual([item.id]);
    expect(graph.links.some((l) => l.type === "RECALLED")).toBe(false);
  });

  it("lists every work item of the project, done ones included", async () => {
    const { body } = await get(`/api/projects/${ctx.projectId}/items`);
    expect((body as { items: { kind: string }[] }).items.map((i) => i.kind)).toEqual(
      expect.arrayContaining(["planner", "architect"]),
    );
  });

  it("returns the events the gateway still holds for the project", async () => {
    events.emit(ctx.projectId, "metrics.updated", { metric: "x", value: 1 });
    const { body } = await get(`/api/projects/${ctx.projectId}/events`);
    expect((body as { events: { type: string }[] }).events.at(-1)).toMatchObject({
      type: "metrics.updated",
    });
  });
});

describe("code view", () => {
  const files = async (q = "") =>
    (await get(`/api/projects/${ctx.projectId}/cards/CARD-01/files${q}`)).body as {
      source: string;
      files: { path: string; change: string | null }[];
    };

  it("reads main while the card has no worktree", async () => {
    expect(await files()).toEqual({ source: "main", files: [{ path: "hello.ts", change: null }] });
  });

  it("shows a card's worktree live: changed, new and untracked files, and the card's diff", async () => {
    const repo = join(workspaces, ctx.projectId, "repo");
    const wt = join(workspaces, ctx.projectId, "wt", "CARD-01");
    execFileSync("git", ["worktree", "add", "-q", "-b", "card/CARD-01", wt, "main"], { cwd: repo });
    writeFileSync(join(wt, "hello.ts"), "export const hello = 2;\n"); // not committed yet
    writeFileSync(join(wt, "new.ts"), "export const fresh = true;\n"); // untracked
    expect(await files()).toEqual({
      source: "worktree",
      files: [
        { path: "hello.ts", change: "modified" },
        { path: "new.ts", change: "added" },
      ],
    });
    const { body } = await get(`/api/projects/${ctx.projectId}/cards/CARD-01/file?path=hello.ts`);
    expect(body).toMatchObject({ text: "export const hello = 2;\n", truncated: false });
    expect((body as { diff: string }).diff).toContain("+export const hello = 2;");
  });

  it("reads main as the finished code, untouched by a card's worktree", async () => {
    const main = await get(`/api/projects/${ctx.projectId}/cards/main/files`);
    expect(main.body).toEqual({ source: "main", files: [{ path: "hello.ts", change: null }] });
    const { body } = await get(`/api/projects/${ctx.projectId}/cards/main/file?path=hello.ts`);
    expect(body).toMatchObject({ text: "export const hello = 1;\n", diff: "" });
  });

  it("refuses a path that leaves the tree, and a bad card key", async () => {
    for (const path of ["../repo/hello.ts", ".git/config", "/etc/passwd", "C:/x"]) {
      const r = await get(
        `/api/projects/${ctx.projectId}/cards/CARD-01/file?path=${encodeURIComponent(path)}`,
      );
      expect(r.status).toBe(400);
    }
    expect((await get(`/api/projects/${ctx.projectId}/cards/nope/files`)).status).toBe(400);
  });
});

describe("read view and time order", () => {
  it("returns an item with every node it read, and graph nodes carry createdAt", async () => {
    const item = (await openItem(ctx, { kind: "launch", createdBy: "human:test", now: 5 }))!;
    await recordRecall(ctx, {
      itemId: item.id,
      agent: "planner",
      ids: [codeChangeId],
      keys: [],
      now: 6,
    });
    const { body } = await get(`/api/projects/${ctx.projectId}/recalled/${item.id}`);
    const path = (
      body as { path: { nodes: { id: string; title: string }[]; links: { type: string }[] } }
    ).path;
    expect(path.nodes.map((n) => n.id).sort()).toEqual([item.id, codeChangeId].sort());
    expect(path.nodes.find((n) => n.id === item.id)?.title).toBe("launch work item");
    expect(path.links).toEqual([
      expect.objectContaining({ type: "RECALLED", target: codeChangeId }),
    ]);
    const graph = (await get(`/api/projects/${ctx.projectId}/graph`)).body as {
      nodes: { createdAt?: number }[];
    };
    expect(graph.nodes.every((n) => typeof n.createdAt === "number")).toBe(true);
  });
});

describe("splitDiff", () => {
  it("splits git show output into one patch per file", () => {
    const text = "diff --git a/a.ts b/a.ts\n+1\ndiff --git a/dir/b.ts b/dir/b.ts\n-2\n";
    expect(splitDiff(text)).toEqual([
      { path: "a.ts", patch: "diff --git a/a.ts b/a.ts\n+1\n" },
      { path: "dir/b.ts", patch: "diff --git a/dir/b.ts b/dir/b.ts\n-2\n" },
    ]);
  });
});
