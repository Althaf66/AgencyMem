// The live preview with a real child process: a fixture repo whose `npm run dev` serves one page on
// $PORT. No mocks.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createEvents } from "./events/bus";
import { createPreviews } from "./preview";

const P = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const dir = mkdtempSync(join(tmpdir(), "am-preview-"));
const events = createEvents();
const previews = createPreviews({ events });

afterAll(() => {
  previews.stopAll();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

/** Waits until the preview leaves `from`, or 30 s. */
async function settle(from: string[]) {
  for (let i = 0; i < 120 && from.includes(previews.get(P).status); i++) {
    await new Promise((r) => setTimeout(r, 250));
  }
  return previews.get(P);
}

describe("preview", () => {
  it("fails with the reason when the project has no repository", async () => {
    previews.start(P, join(dir, "missing"));
    const view = await settle(["starting", "installing"]);
    expect(view.status).toBe("failed");
    expect(view.log.at(-1)).toBe("The project has no repository yet.");
  });

  it("runs main's `npm run dev` on a free port, then stops it", { timeout: 60_000 }, async () => {
    const repo = join(dir, "project", "repo");
    mkdirSync(repo, { recursive: true });
    writeFileSync(
      join(repo, "package.json"),
      JSON.stringify({ name: "fixture", private: true, scripts: { dev: "node server.js" } }),
    );
    writeFileSync(
      join(repo, "server.js"),
      'require("node:http").createServer((q, s) => s.end("clinic " + (process.env.AM_UI_TOKEN ?? "no token")))' +
        '.listen(Number(process.env.PORT), "127.0.0.1", () => console.log("listening"));\n',
    );
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo });
    git("init", "-q", "-b", "main");
    git("add", ".");
    git("commit", "-qm", "starter");

    process.env.AM_UI_TOKEN = "secret-ui"; // must not reach the app
    const seen: string[] = [];
    const off = events.on((e) => e.type === "preview.changed" && seen.push(e.data.status));
    previews.start(P, join(dir, "project"));
    const view = await settle(["starting", "installing"]);
    expect(view.status).toBe("ready");
    expect(await (await fetch(view.url!)).text()).toBe("clinic no token");

    expect(previews.stop(P).status).toBe("stopped");
    await new Promise((r) => setTimeout(r, 500));
    await expect(fetch(view.url!)).rejects.toThrow();
    expect(seen).toEqual(expect.arrayContaining(["starting", "ready", "stopped"]));
    off();
    delete process.env.AM_UI_TOKEN;
  });
});
