// The runner loop (agent-prompts.md section 1): claim, recall, think, act, hand off, complete, with
// one run step after each, a heartbeat while the item is in hand, and the act-step failure rules.
import { setTimeout as sleep } from "node:timers/promises";
import type { RunInput } from "@agencymem/contracts";
import {
  ModelOutputError,
  ModelRequestError,
  ModelUnavailableError,
  type ModelClient,
} from "@agencymem/llm";
import type { ActResult, Agent, Recall } from "./agent";
import { ToolRejected, listProjects, openSession, type Gateway, type Session } from "./mcp-client";

export type ItemResult = "idle" | "done" | "failed" | "stopped";

const NOTE_MAX = 1000; // complete_item note

const leaseLost = (e: unknown) => e instanceof ToolRejected && e.rejection.guard === "lease";

/** "Read 0 handoffs, 14 facts": one count per context group recall_context filled. */
function readText(recall: Recall): string {
  const groups = Object.entries(recall.context)
    .filter(([, value]) => Array.isArray(value))
    .map(([key, value]) => `${(value as unknown[]).length} ${key}`);
  return groups.length ? `Read ${groups.join(", ")}` : "Read nothing";
}

const taskLine = (agent: Agent<unknown>, recall: Recall) =>
  typeof agent.task === "string" ? agent.task : agent.task(recall);

/**
 * Takes one item of the agent's kinds from claim to complete. "stopped" means the lease was lost:
 * the item is already back in the queue, so complete_item is not called.
 */
export async function runItem(
  agent: Agent<unknown>,
  session: Session,
  llm: ModelClient,
  opts: { heartbeatMs: number },
): Promise<ItemResult> {
  const { item } = await session.call("claim_item", { kinds: agent.kinds });
  if (!item) return "idle";
  const itemId = item.id;
  const say = (step: string, text: string, extra: Partial<RunInput> = {}) =>
    session.step({ itemId, step, text: text.slice(0, 200), ...extra });
  await say("claim", `Claimed ${item.kind}`);

  let lost = false;
  const beat = setInterval(() => {
    session.call("heartbeat", { itemId }).catch((e: unknown) => {
      if (leaseLost(e)) lost = true; // stop at the next step; another worker may claim it
    });
  }, opts.heartbeatMs);

  const runs: RunInput[] = [];
  const complete = async (outcome: "done" | "failed", note?: string): Promise<ItemResult> => {
    if (lost) return "stopped";
    try {
      await session.call("complete_item", {
        itemId,
        outcome,
        ...(note === undefined ? {} : { note: note.slice(0, NOTE_MAX) }),
        runs,
      });
    } catch (e) {
      if (leaseLost(e)) return "stopped";
      throw e;
    }
    if (outcome === "done") await say("done", "Done");
    return outcome;
  };

  try {
    const recallItem = async () => {
      const recall = await session.call("recall_context", { itemId });
      await say("recall", readText(recall));
      return recall;
    };
    let recall = await recallItem();
    let note = "";
    let retriedVersion = false;
    let retriedSource = false;
    let result: ActResult;
    for (;;) {
      if (lost) return "stopped";
      const thought = await llm.json({
        tier: agent.tier,
        system: agent.prompt,
        user: `CONTEXT: ${JSON.stringify(agent.select(recall))}\nTASK: ${taskLine(agent, recall)}${note}`,
        schema: agent.output,
        check: agent.check ? (output) => agent.check!(output, recall) : undefined,
        ...(agent.maxTokens ? { maxTokens: agent.maxTokens } : {}),
      });
      runs.push(...thought.runs);
      const last = thought.runs.at(-1)!;
      await say("think", `Thinking (${last.model})`, {
        model: last.model,
        endpoint: last.endpoint,
        tokensIn: thought.runs.reduce((n, r) => n + r.tokensIn, 0),
        tokensOut: thought.runs.reduce((n, r) => n + r.tokensOut, 0),
        ms: thought.runs.reduce((n, r) => n + r.ms, 0),
      });
      // The write tools have no lease guard, so a lease lost during the model call must stop the
      // item before act writes anything (contracts.md, heartbeat: stop work at once).
      if (lost) return "stopped";
      try {
        result = await agent.act(thought.output, recall, {
          call: session.call.bind(session),
          say: (text) => say("act", text),
        });
        break;
      } catch (e) {
        if (!(e instanceof ToolRejected) || leaseLost(e)) throw e;
        // agent-prompts.md, Act-step failures: an old version thinks again on a fresh recall; a
        // missing source thinks again with the reason. Once each.
        if (e.reasonCode === "VERSION_OLD" && !retriedVersion) {
          retriedVersion = true;
          recall = await recallItem();
          continue;
        }
        if (e.reasonCode === "SOURCE_MISSING" && !retriedSource) {
          retriedSource = true;
          note = `\nYour last output was rejected: ${e.rejection.reason} Return the whole corrected JSON.`;
          continue;
        }
        return await complete("failed", e.rejection.reason);
      }
    }
    if (lost) return "stopped";
    if (agent.handoff.includes(item.kind)) {
      await session.call("write_handoff", {
        itemId,
        summary: result.summary,
        outputIds: result.outputIds,
      });
      await say("handoff", "Handed off");
    }
    return await complete("done");
  } catch (e) {
    if (leaseLost(e)) return "stopped";
    if (e instanceof ModelUnavailableError) {
      runs.push(...e.runs);
      return complete("failed", "model unavailable");
    }
    if (e instanceof ModelOutputError || e instanceof ModelRequestError) {
      runs.push(...e.runs);
      return complete("failed", e.message);
    }
    if (e instanceof ToolRejected) return complete("failed", e.rejection.reason);
    throw e; // the gateway is unreachable: runLoop backs off; the lease ends on its own
  } finally {
    clearInterval(beat);
  }
}

export type LoopDeps = Gateway & {
  llm: ModelClient;
  heartbeatMs: number;
  /** The wait after a pass that found no work. */
  idleMs?: number;
  /** Where to look for work; by default every project that is not closed (route 2). */
  projects?: () => Promise<string[]>;
  signal?: AbortSignal;
};

const IDLE_MS = 2000;
const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 30_000;

const wait = (ms: number, signal?: AbortSignal) =>
  sleep(ms, undefined, { signal }).catch(() => undefined); // an abort ends the wait early

/**
 * One agent's loop: each pass tries every project once, keeping one MCP session per project. A
 * pass with no work waits idleMs; a gateway error backs off from 1 s, doubling, up to 30 s.
 */
export async function runLoop(agent: Agent<unknown>, deps: LoopDeps): Promise<void> {
  const sessions = new Map<string, Session>();
  const projects = deps.projects ?? (() => listProjects(deps));
  const workerId = agent.worker ?? `${agent.id}-1`;
  let backoff = 0;
  try {
    while (!deps.signal?.aborted) {
      let worked = false;
      try {
        const ids = await projects();
        for (const [projectId, session] of sessions) {
          if (ids.includes(projectId)) continue; // closed or gone: end its session
          sessions.delete(projectId);
          await session.close().catch(() => undefined);
        }
        for (const projectId of ids) {
          if (deps.signal?.aborted) break;
          let session = sessions.get(projectId);
          if (!session) {
            session = await openSession(deps, { agent: agent.id, projectId, workerId });
            sessions.set(projectId, session);
          }
          try {
            const result = await runItem(agent, session, deps.llm, {
              heartbeatMs: deps.heartbeatMs,
            });
            if (result !== "idle") worked = true;
          } catch (e) {
            sessions.delete(projectId); // a broken session: open a new one next pass
            await session.close().catch(() => undefined);
            throw e;
          }
        }
        backoff = 0;
      } catch (e) {
        backoff = Math.min(backoff ? backoff * 2 : BACKOFF_MIN_MS, BACKOFF_MAX_MS);
        console.error(
          `runner: ${agent.id}: ${e instanceof Error ? e.message : "error"}; retry in ${backoff} ms`,
        );
        await wait(backoff, deps.signal);
        continue;
      }
      if (!worked) await wait(deps.idleMs ?? IDLE_MS, deps.signal);
    }
  } finally {
    await Promise.all([...sessions.values()].map((s) => s.close().catch(() => undefined)));
  }
}
