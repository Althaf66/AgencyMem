// runItem against a scripted session: the order of the loop steps and the act-step failure rules of
// agent-prompts.md section 1. The real gateway run is tests/runner/loop.test.ts.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Rejection, ToolName } from "@agencymem/contracts";
import { createModelClient, replayChat, type Chat, type ChatRequest } from "@agencymem/llm";
import type { Agent } from "./agent";
import { runItem } from "./loop";
import { ToolRejected, type Session, type StepBody } from "./mcp-client";

const ITEM = "01JA0000000000000000000001";
const item = {
  id: ITEM,
  projectId: "01JA0000000000000000000009",
  kind: "intake",
  status: "claimed",
  subjectId: null,
  note: null,
  handoff: null,
  outputIds: [],
  leaseOwner: "intake-1",
  leaseUntil: 1,
  attempts: 0,
  version: 2,
  createdBy: "human:ana",
  createdAt: 1,
  doneAt: null,
};
const recall = { item, project: {}, context: { handoffs: [], episodes: [{}, {}] }, chars: 10 };

const rejection = (guard: string, reasonCode: string): Rejection =>
  ({
    code: "GUARD_REJECTED",
    guard,
    reason: `${reasonCode} reason`,
    details: { reasonCode },
  }) as Rejection;

type Handler = (input: Record<string, unknown>, n: number) => unknown;

/** A session whose tools answer from `handlers`; it records every call and step. */
function session(handlers: Partial<Record<ToolName, Handler>> = {}) {
  const calls: [ToolName, Record<string, unknown>][] = [];
  const steps: StepBody[] = [];
  const count: Partial<Record<ToolName, number>> = {};
  const defaults: Partial<Record<ToolName, Handler>> = {
    claim_item: () => ({ item }),
    recall_context: () => recall,
    write_handoff: () => ({ itemId: ITEM, reportId: null }),
    complete_item: (input) => ({
      item: { id: ITEM, status: input.outcome === "done" ? "done" : "open", attempts: 0 },
      opened: [],
    }),
    heartbeat: () => ({ leaseUntil: 2 }),
  };
  const s: Session = {
    agent: "intake",
    projectId: item.projectId,
    async call(name, input) {
      const args = input as Record<string, unknown>;
      calls.push([name, args]);
      count[name] = (count[name] ?? 0) + 1;
      const handler = handlers[name] ?? defaults[name];
      if (!handler) throw new Error(`unexpected tool ${name}`);
      const out = handler(args, count[name]!);
      if (out instanceof ToolRejected) throw out;
      return out as never;
    },
    async step(body) {
      steps.push(body);
    },
    async close() {},
  };
  return { s, calls, steps, tools: () => calls.map(([name]) => name) };
}

const Output = z.object({ summary: z.string() });
const good = JSON.stringify({ summary: "2 episodes read" });

/** A minimal agent whose act runs `act` (by default: nothing). */
function agent(
  act: Agent<z.infer<typeof Output>>["act"] = async () => ({
    outputIds: [],
    summary: "2 episodes read",
  }),
) {
  return {
    id: "intake",
    kinds: ["intake"],
    tier: "thin",
    task: "Echo the context.",
    prompt: "You are a test agent.",
    output: Output,
    handoff: ["intake"],
    select: (r) => r.context,
    act,
  } satisfies Agent<z.infer<typeof Output>>;
}

const llm = (replies: string[]) => createModelClient({ chat: replayChat(replies), prices: {} });
const opts = { heartbeatMs: 60_000 };

describe("runItem: one item from claim to complete", () => {
  it("claims, recalls, thinks, acts, hands off and completes, with a run step after each", async () => {
    const { s, calls, steps, tools } = session();
    const result = await runItem(
      agent(async (_out, _recall, act) => {
        await act.say("Wrote 0 facts");
        return { outputIds: [], summary: "2 episodes read" };
      }),
      s,
      llm([good]),
      opts,
    );
    expect(result).toBe("done");
    expect(tools()).toEqual(["claim_item", "recall_context", "write_handoff", "complete_item"]);
    expect(calls[0]![1]).toEqual({ kinds: ["intake"] });
    expect(calls[2]![1]).toEqual({ itemId: ITEM, summary: "2 episodes read", outputIds: [] });
    expect(calls[3]![1]).toMatchObject({
      itemId: ITEM,
      outcome: "done",
      runs: [{ step: "think", model: "replay", endpoint: "primary" }],
    });
    expect(steps.map((st) => st.text)).toEqual([
      "Claimed intake",
      "Read 0 handoffs, 2 episodes",
      "Thinking (replay)",
      "Wrote 0 facts",
      "Handed off",
      "Done",
    ]);
    expect(steps.every((st) => st.itemId === ITEM)).toBe(true);
  });

  it("is idle when there is nothing to claim", async () => {
    const { s, tools } = session({ claim_item: () => ({ item: null }) });
    expect(await runItem(agent(), s, llm([good]), opts)).toBe("idle");
    expect(tools()).toEqual(["claim_item"]);
  });
});

describe("runItem: act-step failures (agent-prompts.md section 1)", () => {
  it("fails the item when the model's JSON fails twice, with both runs", async () => {
    const { s, calls } = session();
    expect(await runItem(agent(), s, llm(["no", "still no"]), opts)).toBe("failed");
    const complete = calls.find(([name]) => name === "complete_item")![1];
    expect(complete).toMatchObject({ outcome: "failed", note: expect.stringMatching(/checks/) });
    expect((complete.runs as unknown[]).length).toBe(2);
  });

  it('fails the item with "model unavailable" when both endpoints fail', async () => {
    const { s, calls } = session();
    const down: Chat = async () => {
      const { ModelUnavailableError } = await import("@agencymem/llm");
      throw new ModelUnavailableError("both down");
    };
    const client = createModelClient({ chat: down, prices: {} });
    expect(await runItem(agent(), s, client, opts)).toBe("failed");
    expect(calls.at(-1)).toEqual([
      "complete_item",
      { itemId: ITEM, outcome: "failed", note: "model unavailable", runs: [] },
    ]);
  });

  it("stops without complete_item when the lease has ended", async () => {
    const { s, tools } = session();
    const lost = agent(async () => {
      throw new ToolRejected("write_fact", rejection("lease", "LEASE_ENDED"));
    });
    expect(await runItem(lost, s, llm([good]), opts)).toBe("stopped");
    expect(tools()).not.toContain("complete_item");
  });

  it("stops without complete_item when a heartbeat finds the lease gone", async () => {
    const { s, tools } = session({
      heartbeat: () => new ToolRejected("heartbeat", rejection("lease", "LEASE_OTHER_WORKER")),
    });
    const slow = agent(async () => {
      await new Promise((r) => setTimeout(r, 60));
      return { outputIds: [], summary: "2 episodes read" };
    });
    expect(await runItem(slow, s, llm([good]), { heartbeatMs: 10 })).toBe("stopped");
    expect(tools()).toContain("heartbeat");
    expect(tools()).not.toContain("complete_item");
  });

  it("does not act when the lease was lost during the model call", async () => {
    const { s, tools } = session({
      heartbeat: () => new ToolRejected("heartbeat", rejection("lease", "LEASE_ENDED")),
    });
    const replies = replayChat([good]);
    const slowModel: Chat = async (req) => {
      await new Promise((r) => setTimeout(r, 60));
      return replies(req);
    };
    let acted = false;
    const writer = agent(async () => {
      acted = true;
      return { outputIds: [], summary: "2 episodes read" };
    });
    const client = createModelClient({ chat: slowModel, prices: {} });
    expect(await runItem(writer, s, client, { heartbeatMs: 10 })).toBe("stopped");
    expect(acted).toBe(false);
    expect(tools()).not.toContain("complete_item");
  });

  it("writes a handoff only for the item kinds that have one", async () => {
    const answer = { ...item, kind: "intake_answer" };
    const { s, tools } = session({ claim_item: () => ({ item: answer }) });
    const intake: Agent<z.infer<typeof Output>> = {
      ...agent(),
      kinds: ["intake", "intake_answer"],
    };
    expect(await runItem(intake, s, llm([good]), opts)).toBe("done");
    expect(tools()).not.toContain("write_handoff");
  });

  it("thinks once more with the reason after SOURCE_MISSING", async () => {
    const asked: ChatRequest[] = [];
    const replies = replayChat([good, good]);
    const chat: Chat = (req) => {
      asked.push(req);
      return replies(req);
    };
    let tries = 0;
    const picky = agent(async () => {
      tries += 1;
      if (tries === 1) throw new ToolRejected("write_fact", rejection("source", "SOURCE_MISSING"));
      return { outputIds: [], summary: "2 episodes read" };
    });
    const { s } = session();
    expect(await runItem(picky, s, createModelClient({ chat, prices: {} }), opts)).toBe("done");
    expect(asked).toHaveLength(2);
    expect(asked[1]!.messages[1]!.content).toMatch(/SOURCE_MISSING reason/);
  });

  it("recalls and thinks again once after VERSION_OLD", async () => {
    let tries = 0;
    const stale = agent(async () => {
      tries += 1;
      if (tries === 1) throw new ToolRejected("write_product", rejection("version", "VERSION_OLD"));
      return { outputIds: [], summary: "2 episodes read" };
    });
    const { s, tools } = session();
    expect(await runItem(stale, s, llm([good, good]), opts)).toBe("done");
    expect(tools().filter((t) => t === "recall_context")).toHaveLength(2);
  });

  it("fails the item with the reason for any other guard rejection", async () => {
    const { s, calls } = session();
    const refused = agent(async () => {
      throw new ToolRejected("write_fact", rejection("ownership", "LABEL_NOT_OWNED"));
    });
    expect(await runItem(refused, s, llm([good]), opts)).toBe("failed");
    expect(calls.at(-1)![1]).toMatchObject({ outcome: "failed", note: "LABEL_NOT_OWNED reason" });
  });
});
