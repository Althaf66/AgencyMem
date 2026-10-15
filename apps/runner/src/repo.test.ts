// Task 3.7, Done when: a new project has a repository with the hook installed. Real git in a
// temporary WORKSPACES_DIR; npm ci is skipped (install: false), so the test needs no network.
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { ensureRepo } from "./repo";

const run = promisify(execFile);
const STARTER = fileURLToPath(new URL("../templates/app-starter", import.meta.url));
const PID = "01JA0000000000000000000001";
const workspaces = mkdtempSync(join(tmpdir(), "am-ws-"));
afterAll(() => rmSync(workspaces, { recursive: true, force: true }));

const git = async (cwd: string, args: string[], env: Record<string, string> = {}) =>
  (await run("git", args, { cwd, env: { ...process.env, ...env } })).stdout.trim();

/** Every file of the starter, as git paths. */
function starterFiles(dir = STARTER): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.name === "node_modules"
      ? []
      : e.isDirectory()
        ? starterFiles(join(dir, e.name))
        : [relative(STARTER, join(dir, e.name)).replaceAll("\\", "/")],
  );
}

// Real git with a hook that starts sh and curl: slow on Windows under a full test run.
describe("ensureRepo (sample-app.md section 10)", { timeout: 30_000 }, () => {
  it("creates the repository with the starter in one commit, the hook, the project id and the excludes", async () => {
    const repo = await ensureRepo(PID, { workspacesDir: workspaces, install: false });
    expect(repo).toBe(join(workspaces, PID, "repo"));
    expect(await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main");
    expect(await git(repo, ["log", "--format=%s|%an|%ae"])).toBe(
      "chore: starter|agencymem|runner@agencymem.local",
    );
    expect((await git(repo, ["ls-files"])).split("\n").sort()).toEqual(starterFiles().sort());

    const hook = join(repo, ".git", "hooks", "post-commit");
    expect(readFileSync(hook)).toEqual(readFileSync(join(STARTER, ".githooks", "post-commit")));
    if (process.platform !== "win32") expect(statSync(hook).mode & 0o777).toBe(0o755);
    expect(await git(repo, ["config", "agencymem.projectId"])).toBe(PID);
    const exclude = readFileSync(join(repo, ".git", "info", "exclude"), "utf8").split(/\r?\n/);
    expect(exclude).toEqual(expect.arrayContaining(["AGENTS.md", "opencode.json"]));

    // A second call changes nothing.
    expect(await ensureRepo(PID, { workspacesDir: workspaces, install: false })).toBe(repo);
    expect(await git(repo, ["rev-list", "--count", "HEAD"])).toBe("1");
    const again = readFileSync(join(repo, ".git", "info", "exclude"), "utf8");
    expect(again.match(/^AGENTS\.md$/gm)).toHaveLength(1);
  });

  it("refuses a workspaces folder inside the AgencyMem repository", async () => {
    const inside = fileURLToPath(new URL("../../../.am-ws-test", import.meta.url));
    await expect(ensureRepo(PID, { workspacesDir: inside, install: false })).rejects.toThrow(
      /inside the AgencyMem repository/,
    );
    expect(existsSync(inside)).toBe(false);
  });

  it("posts each commit to the gateway, and logs it when the gateway is down (contracts.md section 9)", async () => {
    const repo = await ensureRepo(PID, { workspacesDir: workspaces, install: false });
    const posts: { url: string; headers: IncomingHttpHeaders; body: unknown }[] = [];
    const server = createServer((req, res) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => {
        posts.push({ url: req.url ?? "", headers: req.headers, body: JSON.parse(data) });
        res.writeHead(201, { "Content-Type": "application/json" }).end("{}");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const env = {
      GATEWAY_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      AM_HOOK_TOKEN: "hook-t",
    };

    await git(repo, ["checkout", "-b", "card/CARD-01"]);
    await git(repo, ["commit", "--allow-empty", "-m", 'feat(CARD-01): say "hello"'], env);
    const sha = await git(repo, ["rev-parse", "HEAD"]);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe("/hooks/commit");
    expect(posts[0]!.headers["x-am-token"]).toBe("hook-t");
    expect(posts[0]!.body).toEqual({
      projectId: PID,
      sha,
      branch: "card/CARD-01",
      files: [],
      message: 'feat(CARD-01): say "hello"',
      author: "agencymem",
      committedAt: expect.any(Number),
    });

    await new Promise((resolve) => server.close(resolve));
    await git(repo, ["commit", "--allow-empty", "-m", "offline"], env);
    const pending = readFileSync(join(repo, ".git", "am-pending.log"), "utf8").trim();
    expect(JSON.parse(pending)).toMatchObject({ projectId: PID, message: "offline" });
  });
});
