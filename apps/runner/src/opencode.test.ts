// Task 4.5: the OpenCode runner. A fake `opencode` (opencode.fake.mjs) proves the arguments, the
// environment, the events, the heartbeat and the three stops. The Done when check, a real
// OpenCode run on a test card, calls a paid model, so it runs only with OPENCODE_LIVE=1.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { ToolRejected } from "./mcp-client";
import { writeCardConfig } from "./opencode-config";
import { checkOpenCodeVersion, failureNote, opencodeBin, runOpenCode } from "./opencode";
import { ensureRepo } from "./repo";
import { ensureWorktree } from "./worktree";

const FAKE = [process.execPath, fileURLToPath(new URL("./opencode.fake.mjs", import.meta.url))];
const tree = mkdtempSync(join(tmpdir(), "am-oc-"));
afterAll(() => rmSync(tree, { recursive: true, force: true }));

const base = {
  tree,
  cardKey: "CARD-01",
  model: "fallback/vendor/model",
  env: {
    AM_PROJECT_ID: "01JA0000000000000000000004",
    AM_WORKER_ID: "build-1",
    GATEWAY_URL: "http://127.0.0.1:4000",
    AM_HOOK_TOKEN: "hook-t",
    PORT: "5181",
  },
  heartbeat: async () => {},
  heartbeatMs: 60_000,
};
const withMode = (mode: string) => {
  process.env.FAKE_OC = mode;
  return FAKE;
};
afterAll(() => delete process.env.FAKE_OC);

describe("runOpenCode", () => {
  it("runs opencode with the TD flags and the worker's environment, and passes each JSON event on", async () => {
    const events: { type: string; argv?: string[]; env?: Record<string, string> }[] = [];
    const result = await runOpenCode({
      ...base,
      bin: withMode("ok"),
      onEvent: (e) => events.push(e as never),
    });

    expect(result).toMatchObject({
      reason: "exit",
      exitCode: 0,
      tokens: { input: 15, output: 4 },
      providerError: null,
    });
    expect(events.map((e) => e.type)).toEqual([
      "args",
      "tool_use",
      "tool_use",
      "step_finish",
      "step_finish",
    ]);
    expect(events[0]!.argv).toEqual([
      "run",
      "--dir",
      tree,
      "--model",
      "fallback/vendor/model",
      "--format",
      "json",
      "--auto",
      "Build card CARD-01. Follow AGENTS.md. Start with get_task_context.",
    ]);
    expect(events[0]!.env).toEqual({ ...base.env, OPENCODE_DISABLE_CLAUDE_CODE: "1" });
  });

  it("sends heartbeats, and stops the process when the lease is lost", async () => {
    let beats = 0;
    const result = await runOpenCode({
      ...base,
      bin: withMode("hang"),
      heartbeatMs: 50,
      heartbeat: async () => {
        beats += 1;
        if (beats === 2) {
          throw new ToolRejected("heartbeat", {
            code: "GUARD_REJECTED",
            guard: "lease",
            reason: "The lease ended.",
            details: { reasonCode: "LEASE_ENDED" },
          });
        }
      },
    });
    expect(result.reason).toBe("lease");
    expect(beats).toBe(2);
  });

  it("keeps going when a heartbeat fails for another reason", async () => {
    let beats = 0;
    const result = await runOpenCode({
      ...base,
      bin: withMode("hang"),
      heartbeatMs: 30,
      timeoutMs: 400,
      heartbeat: async () => {
        beats += 1;
        throw new Error("fetch failed");
      },
    });
    expect(result.reason).toBe("timeout");
    expect(beats).toBeGreaterThan(2);
  });

  it("stops a run that goes past the timeout", async () => {
    const started = Date.now();
    const result = await runOpenCode({ ...base, bin: withMode("hang"), timeoutMs: 300 });
    expect(result).toMatchObject({ reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("stops a run that stalls on empty steps (a provider that sends nothing)", async () => {
    const result = await runOpenCode({ ...base, bin: withMode("stall"), timeoutMs: 10_000 });
    expect(result.reason).toBe("stall");
  });
});

// Task 4.12, Done when: a simulated HTTP 429. Build runs on the fallback model only (developer
// decision, 2026-10-16), so there is no other model to retry on: the run is one failed attempt with
// the provider error as its note, and 2 failed attempts block the card (claim_task skips it).
describe("a provider error", () => {
  it("reports a simulated HTTP 429 as a provider error and notes the failed attempt", async () => {
    const result = await runOpenCode({ ...base, bin: withMode("429") });
    expect(result).toMatchObject({ reason: "exit", exitCode: 1, providerError: { status: 429 } });
    expect(failureNote(result)).toBe("Provider error (HTTP 429).");
  });

  it("notes every other way a run ends without complete_task", () => {
    const run = {
      reason: "exit" as const,
      exitCode: 0,
      ms: 1,
      tokens: { input: 0, output: 0 },
      providerError: null,
    };
    expect(failureNote({ ...run, providerError: { status: null } })).toBe(
      "Provider error (no HTTP status).",
    );
    expect(failureNote({ ...run, reason: "timeout" })).toBe("The run passed its 30-minute limit.");
    expect(failureNote({ ...run, reason: "stall" })).toBe("The provider sent only empty replies.");
    expect(failureNote({ ...run, reason: "spawn" })).toBe("OpenCode did not start.");
    expect(failureNote({ ...run, reason: "lease" })).toBe("The lease ended.");
    expect(failureNote({ ...run, reason: "exit" })).toBe(
      "OpenCode exited (code 0) without calling complete_task.",
    );
  });
});

describe("runOpenCode stops cleanly", () => {
  it("passes the keys opencode.json needs and leaves out the other AgencyMem settings", async () => {
    process.env.LLM_API_KEY = "kept-for-opencode-json";
    process.env.AM_UI_TOKEN = "not-for-opencode";
    const events: { env?: Record<string, string> }[] = [];
    try {
      await runOpenCode({ ...base, bin: withMode("ok"), onEvent: (e) => events.push(e as never) });
    } finally {
      delete process.env.LLM_API_KEY;
      delete process.env.AM_UI_TOKEN;
    }
    expect(events[0]!.env).toMatchObject({ LLM_API_KEY: "kept-for-opencode-json" });
    expect(events[0]!.env).not.toHaveProperty("AM_UI_TOKEN");
  });

  it(
    "ends the processes OpenCode started, even when they hold its stdout",
    { timeout: 20_000 },
    async () => {
      let kid = 0;
      const result = await runOpenCode({
        ...base,
        bin: withMode("tree"),
        timeoutMs: 500,
        onEvent: (e) => {
          if ((e as { type: string }).type === "child") kid = (e as { pid: number }).pid;
        },
      });
      expect(result.reason).toBe("timeout");
      expect(kid).toBeGreaterThan(0);
      const alive = () => {
        try {
          process.kill(kid, 0);
          return true;
        } catch {
          return false;
        }
      };
      for (let i = 0; i < 50 && alive(); i++) await new Promise((r) => setTimeout(r, 100));
      expect(alive()).toBe(false);
    },
  );

  it("reports a binary that does not start as spawn, not as an exit", async () => {
    const result = await runOpenCode({ ...base, bin: ["am-no-such-opencode-binary"] });
    expect(result).toMatchObject({ reason: "spawn", exitCode: null });
  });

  it("survives an onEvent listener that throws", async () => {
    const result = await runOpenCode({
      ...base,
      bin: withMode("ok"),
      onEvent: () => {
        throw new Error("listener bug");
      },
    });
    expect(result).toMatchObject({ reason: "exit", exitCode: 0 });
  });
});

describe("checkOpenCodeVersion", () => {
  it("accepts the pinned version and refuses another", async () => {
    await expect(checkOpenCodeVersion(withMode("ok"), "1.18.32")).resolves.toBeUndefined();
    await expect(checkOpenCodeVersion(withMode("ok"), "1.19.0")).rejects.toThrow(
      "OpenCode 1.18.32 is installed; OPENCODE_VERSION is 1.19.0",
    );
  });
});

// The Done when check: a real OpenCode run on a test card, on the fallback model.
describe.runIf(process.env.OPENCODE_LIVE === "1")("Done when (live): a test card completes", () => {
  it(
    "OpenCode adds a line to the README and commits it on the card branch",
    { timeout: 600_000 },
    async () => {
      expect(process.env.OPENROUTER_BUILD_MODEL, "OPENROUTER_BUILD_MODEL").toBeTruthy();
      const run = promisify(execFile);
      const workspaces = mkdtempSync(join(tmpdir(), "am-ws-"));
      try {
        const pid = "01JA0000000000000000000005";
        const repo = await ensureRepo(pid, { workspacesDir: workspaces, install: false });
        await run("git", ["branch", "card/CARD-01", "main"], { cwd: repo });
        const wt = await ensureWorktree(pid, "CARD-01", {
          workspacesDir: workspaces,
          install: false,
        });
        await writeCardConfig(wt, "CARD-01", {
          fallbackModel: process.env.OPENROUTER_BUILD_MODEL!,
        });
        // No gateway here: a card AGENTS.md that needs no MCP tool.
        await writeFile(
          join(wt, "AGENTS.md"),
          [
            "# Card CARD-01",
            "",
            "- Add the line `Built by AgencyMem.` at the end of README.md.",
            "- Commit it on this branch with git add and git commit. Do not push.",
            "- Then stop.",
            "",
          ].join("\n"),
        );

        const result = await runOpenCode({
          ...base,
          tree: wt,
          env: { ...base.env, AM_PROJECT_ID: pid },
          bin: await opencodeBin(),
          model: `fallback/${process.env.OPENROUTER_BUILD_MODEL}`,
          onEvent: (e) => console.log((e as { type?: string }).type), // types only, no model text
        });

        expect(result).toMatchObject({ reason: "exit", exitCode: 0 });
        expect(readFileSync(join(wt, "README.md"), "utf8")).toContain("Built by AgencyMem.");
        const log = await run("git", ["log", "--format=%s", "main..card/CARD-01"], { cwd: repo });
        expect(log.stdout.trim()).not.toBe("");
      } finally {
        rmSync(workspaces, { recursive: true, force: true });
      }
    },
  );
});
