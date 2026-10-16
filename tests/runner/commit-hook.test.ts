// Task 4.8, Done when: a commit appears in the graph within 5 seconds. A real git commit in a
// project repository made by ensureRepo, through its installed post-commit hook, to the real
// gateway and FalkorDB. A commit made while the gateway is down waits in am-pending.log until the
// runner replays it (contracts.md section 9). It lives outside apps/, because the runner may not
// import the gateway (AGENTS.md rule 1).
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type ProjectInfo } from "@agencymem/contracts";
import { close, connect, graphFor, type FalkorDB } from "@agencymem/graph";
import { deleteTestClient } from "@agencymem/memory";
import { createGateway } from "../../apps/gateway/src/main";
import { ensureRepo, replayPending } from "../../apps/runner/src/repo";

const run = promisify(execFile);
const TOKENS = { AM_AGENT_TOKEN: "agent-t", AM_UI_TOKEN: "ui-t", AM_HOOK_TOKEN: "hook-t" };
const FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";
// Built at run time, so this file holds no Cypher string literal (AGENTS.md rule 4).
const q = (...parts: string[]) => parts.join(" ");

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
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  for (const graph of graphs) await deleteTestClient(db, graph);
  await close();
  rmSync(workspaces, { recursive: true, force: true });
});

const ui = { "X-AM-Token": "ui-t", "X-AM-Actor": "human:ana" };

/** The CodeChange rows with this sha, through the UI read route. */
async function codeChanges(projectId: string, sha: string): Promise<unknown[][]> {
  const res = await fetch(`${base}/api/query`, {
    method: "POST",
    headers: { ...ui, "Content-Type": "application/json", "X-AM-Project": projectId },
    body: JSON.stringify({
      graph: "client",
      cypher: q("MATCH", `(c:CodeChange {sha: '${sha}'})`, "RETURN", "c.branch, c.message"),
    }),
  });
  return ((await res.json()) as { rows: unknown[][] }).rows;
}

async function waitFor(check: () => Promise<boolean>, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return check();
}

describe("Done when: a commit appears in the graph within 5 seconds", { timeout: 60_000 }, () => {
  it("posts a real commit through the hook, and replays one made while the gateway was down", async () => {
    const res = await fetch(`${base}/api/projects`, {
      method: "POST",
      headers: { ...ui, "Content-Type": "application/json" },
      body: JSON.stringify({
        clientName: `test-client-${randomUUID()}`,
        projectName: "Hook",
        mode: "demo",
      }),
    });
    const { project } = (await res.json()) as { project: ProjectInfo };
    graphs.add(await graphFor(db, project.id));

    const repo = await ensureRepo(project.id, { workspacesDir: workspaces, install: false });
    const git = async (env: Record<string, string>, ...args: string[]) =>
      (
        await run("git", ["-c", "commit.gpgsign=false", ...args], {
          cwd: repo,
          env: { ...process.env, ...env },
        })
      ).stdout.trim();
    await git({}, "checkout", "-b", "card/CARD-01");

    // Gateway up: the hook posts the commit.
    const up = { GATEWAY_URL: base, AM_HOOK_TOKEN: "hook-t" };
    const started = Date.now();
    await git(up, "commit", "--allow-empty", "-m", "feat(CARD-01): first");
    const first = await git({}, "rev-parse", "HEAD");
    expect(
      await waitFor(async () => (await codeChanges(project.id, first)).length === 1, 5_000),
    ).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000); // from the commit to the graph, hook included
    expect(await codeChanges(project.id, first)).toEqual([
      ["card/CARD-01", "feat(CARD-01): first"],
    ]);

    // Gateway down (a closed port): the hook logs the commit instead.
    const down = { GATEWAY_URL: "http://127.0.0.1:9", AM_HOOK_TOKEN: "hook-t" };
    await git(down, "commit", "--allow-empty", "-m", "feat(CARD-01): offline");
    const second = await git({}, "rev-parse", "HEAD");
    const log = join(repo, ".git", "am-pending.log");
    expect(readFileSync(log, "utf8")).toContain(second);
    expect(await codeChanges(project.id, second)).toEqual([]);

    // The runner replays the log, then empties it.
    expect(await replayPending(repo, { gatewayUrl: base, hookToken: "hook-t" })).toEqual({
      sent: 1,
      kept: 0,
    });
    expect(await codeChanges(project.id, second)).toEqual([
      ["card/CARD-01", "feat(CARD-01): offline"],
    ]);
    expect(existsSync(log)).toBe(false);
  });

  it("keeps a line the gateway could not take for now, and drops one it refuses for good", async () => {
    const repo = await ensureRepo("01JA0000000000000000000020", {
      workspacesDir: workspaces,
      install: false,
    });
    const log = join(repo, ".git", "am-pending.log");
    const { writeFileSync } = await import("node:fs");
    const good = JSON.stringify({ projectId: "01JA0000000000000000000020", sha: "a".repeat(40) });
    writeFileSync(log, `${good}\nnot json\n`);

    // Gateway down: nothing is sent, every line stays.
    expect(
      await replayPending(repo, { gatewayUrl: "http://127.0.0.1:9", hookToken: "hook-t" }),
    ).toEqual({
      sent: 0,
      kept: 2,
    });
    // A gateway that fails (500) or a wrong hook token (401): kept, so no commit is lost.
    const { createServer } = await import("node:http");
    const failing = createServer((_req, res) => res.writeHead(500).end("{}"));
    await new Promise<void>((resolve) => failing.listen(0, "127.0.0.1", resolve));
    const failingUrl = `http://127.0.0.1:${(failing.address() as AddressInfo).port}`;
    expect(await replayPending(repo, { gatewayUrl: failingUrl, hookToken: "hook-t" })).toEqual({
      sent: 0,
      kept: 2,
    });
    await new Promise((resolve) => failing.close(resolve));
    expect(await replayPending(repo, { gatewayUrl: base, hookToken: "wrong" })).toEqual({
      sent: 0,
      kept: 2,
    });
    // Gateway up: both are refused for good (unknown project, bad body), so the log is emptied.
    expect(await replayPending(repo, { gatewayUrl: base, hookToken: "hook-t" })).toEqual({
      sent: 0,
      kept: 0,
    });
    expect(existsSync(log)).toBe(false);
  });
});
