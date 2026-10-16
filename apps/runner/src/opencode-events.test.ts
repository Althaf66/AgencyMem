// Task 4.6: OpenCode's JSON events (1.18.32, shapes from the 4.1 spike) as short Run steps
// (technical design "What the board shows from the run"). Never raw model text.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { finalStep, forwardEvents, mapEvent } from "./opencode-events";

const TREE = join("/ws", "P", "wt", "CARD-01");
const tool = (name: string, state: Record<string, unknown>) => ({
  type: "tool_use",
  part: { type: "tool", tool: name, state },
});

describe("mapEvent", () => {
  it("names an agencymem tool call, and its rejection code", () => {
    expect(mapEvent(tool("agencymem_get_task_context", { status: "completed" }), TREE)).toEqual({
      step: "tool",
      text: "Called get_task_context",
    });
    // A real event from OpenCode 1.18.32 (the 4.1 spike): a rejection is status "error" with the
    // gateway's { error } JSON in state.error.
    const real = {
      type: "tool_use",
      part: {
        type: "tool",
        tool: "agencymem_get_task_context",
        state: {
          status: "error",
          input: { taskId: "01M51XG0ZD75ZT2MMZS29E9X8E" },
          error:
            '{"error":{"code":"INTERNAL","reason":"get_task_context is not built yet (task 4.7)."}}',
          time: { start: 1792139601133, end: 1792139601224 },
        },
      },
    };
    expect(mapEvent(real, TREE)).toEqual({
      step: "tool",
      text: "get_task_context rejected: INTERNAL",
    });
    const pending = JSON.stringify({
      error: {
        code: "GUARD_REJECTED",
        guard: "evidence",
        reason: "Wait.",
        details: { reasonCode: "RUN_PENDING" },
      },
    });
    expect(
      mapEvent(tool("agencymem_complete_task", { status: "error", error: pending }), TREE),
    ).toEqual({
      step: "tool",
      text: "complete_task rejected: RUN_PENDING",
    });
    expect(
      mapEvent(
        tool("agencymem_complete_task", { status: "error", error: "MCP error -32602" }),
        TREE,
      ),
    ).toEqual({ step: "tool", text: "complete_task failed" });
  });

  it("shows a file edit as the path inside the worktree", () => {
    const edit = tool("edit", {
      status: "completed",
      input: { filePath: join(TREE, "src", "booking.ts") },
    });
    expect(mapEvent(edit, TREE)).toEqual({ step: "edit", text: "Edited src/booking.ts" });
    const write = tool("write", { status: "completed", input: { filePath: "server/seed.json" } });
    expect(mapEvent(write, TREE)).toEqual({ step: "edit", text: "Edited server/seed.json" });
    // Outside the worktree: the file name only, never a host folder.
    const outside = tool("edit", {
      status: "completed",
      input: { filePath: join("/home", "ana", "notes.md") },
    });
    expect(mapEvent(outside, TREE)).toEqual({ step: "edit", text: "Edited notes.md" });
    // Route 30 refuses text over 200 characters, so a long path is cut, not lost.
    const long = tool("edit", {
      status: "completed",
      input: { filePath: `src/${"a".repeat(300)}.ts` },
    });
    expect(mapEvent(long, TREE)!.text).toHaveLength(200);
  });

  it("shows a bash command by its name only, never its arguments", () => {
    const ran = (command: string, exit = 0) =>
      mapEvent(tool("bash", { status: "completed", input: { command }, metadata: { exit } }), TREE);
    expect(ran("npm test")).toEqual({ step: "bash", text: "Ran npm test" });
    expect(ran("npx playwright test tests/e2e/CARD-01", 1)).toEqual({
      step: "bash",
      text: "Ran npx playwright (exit 1)",
    });
    expect(ran('git commit -m "feat: secret plan"')).toEqual({
      step: "bash",
      text: "Ran git commit",
    });
    expect(ran("sleep 30")).toEqual({ step: "bash", text: "Ran sleep" });
    // Arguments and environment assignments never show: they can hold a key or a file name.
    expect(ran("OPENROUTER_API_KEY=sk-or-abc npx playwright test")).toEqual({
      step: "bash",
      text: "Ran npx playwright",
    });
    expect(ran("rm notes")).toEqual({ step: "bash", text: "Ran rm" });
    expect(ran("cat secrets.txt")).toEqual({ step: "bash", text: "Ran cat" });
    expect(ran("/usr/local/bin/node server.js")).toEqual({ step: "bash", text: "Ran node" });
    expect(ran("TOKEN=abc")).toEqual({ step: "bash", text: "Ran a command" });
  });

  it("shows nothing for model text, step bookkeeping, other tools or a non-event", () => {
    expect(
      mapEvent({ type: "text", part: { text: "I will now edit the file." } }, TREE),
    ).toBeNull();
    expect(mapEvent({ type: "step_start", part: {} }, TREE)).toBeNull();
    expect(mapEvent({ type: "step_finish", part: { reason: "stop" } }, TREE)).toBeNull();
    expect(mapEvent(tool("read", { status: "completed" }), TREE)).toBeNull();
    expect(mapEvent("not an object", TREE)).toBeNull();
  });
});

describe("finalStep", () => {
  const result = {
    exitCode: 0,
    ms: 29_400,
    tokens: { input: 13_000, output: 400 },
    providerError: null,
  };

  it("posts the run's end with the token totals, as the one step that writes a Run", () => {
    expect(finalStep("T1", { ...result, reason: "exit" }, "fallback/vendor/model-y")).toEqual({
      itemId: "T1",
      step: "exit",
      text: "Run finished (exit 0, 29 s)",
      model: "vendor/model-y",
      endpoint: "openrouter",
      tokensIn: 13_000,
      tokensOut: 400,
      ms: 29_400,
      cost: 0,
      final: true,
    });
    expect(finalStep("T1", { ...result, reason: "exit" }, "agencymem/m").endpoint).toBe("primary");
  });

  it("says why a stopped run stopped", () => {
    const text = (reason: "lease" | "timeout" | "stall" | "spawn") =>
      finalStep("T1", { ...result, reason, exitCode: null }, "fallback/m").text;
    expect(text("lease")).toBe("Stopped: the lease ended (29 s)");
    expect(text("timeout")).toBe("Stopped: timed out (29 s)");
    expect(text("stall")).toBe("Stopped: the provider sent nothing (29 s)");
    expect(text("spawn")).toBe("Stopped: OpenCode did not start");
  });
});

describe("forwardEvents", () => {
  it("posts each mapped event as a step of the card, in order, and skips the rest", async () => {
    const posted: unknown[] = [];
    // The first post is the slow one: order must still hold.
    let first = true;
    const post = async (body: unknown) => {
      if (first) {
        first = false;
        await new Promise((r) => setTimeout(r, 50));
      }
      posted.push(body);
    };
    const { onEvent, drain } = forwardEvents(post, "T1", TREE);
    onEvent({ type: "step_start", part: {} });
    onEvent(tool("agencymem_get_task_context", { status: "completed" }));
    onEvent({ type: "text", part: { text: "thinking" } });
    onEvent(tool("bash", { status: "completed", input: { command: "npm test" } }));
    await drain();
    expect(posted).toEqual([
      { itemId: "T1", step: "tool", text: "Called get_task_context" },
      { itemId: "T1", step: "bash", text: "Ran npm test" },
    ]);
  });
});
