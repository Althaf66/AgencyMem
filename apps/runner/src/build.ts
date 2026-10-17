// A build worker (technical design "Build loop and OpenCode", agent-prompts.md section 11): claims a
// Ready card, runs OpenCode on it in the card's worktree, then makes sure the card ends Done or back
// in Ready with a note. The runner starts BUILD_WORKERS of these (build-1, build-2).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { freePort } from "./agents/test/run-tests";
import { leaseLost, type ItemResult, type Worker } from "./loop";
import { ToolRejected, type Session, type ToolOut } from "./mcp-client";
import { failureNote, runOpenCode, type RunResult } from "./opencode";
import { writeCardConfig } from "./opencode-config";
import { finalStep, forwardEvents } from "./opencode-events";
import { replayPending, workspacesPath } from "./repo";
import { ensureWorktree } from "./worktree";

/** agent-prompts.md section 11: retry complete_task every 30 s while the run is pending, 10 tries. */
const PENDING_TRIES = 10;
const PENDING_MS = 30_000;

export type BuildOptions = {
  n: number;
  bin: string[];
  workspacesDir: string;
  gatewayUrl: string;
  hookToken: string;
  /** BUILD_MODEL on TokenHarbor, then ZEN_BUILD_MODEL on OpenCode Zen (developer decision, 2026-10-18). */
  buildModel: string;
  fallbackModel: string;
  heartbeatMs: number;
  /** false skips npm ci in the worktree (tests). */
  install?: boolean;
  /** The wait between RUN_PENDING tries; 30 s unless a test shortens it. */
  pendingMs?: number;
};

type Card = NonNullable<ToolOut<"claim_task">["task"]>;

/** The card is no longer this run's: OpenCode closed it, a person edited it, or the lease ended. */
const notOurs = (e: unknown) =>
  e instanceof ToolRejected && (leaseLost(e) || e.reasonCode === "VERSION_OLD");

/** OpenCode's own complete_task call went through: the card is closed (Done, or back to Ready). */
function closedCard(event: unknown): boolean {
  const e = event as { type?: string; part?: { tool?: string; state?: { status?: string } } };
  return (
    e.type === "tool_use" &&
    e.part?.tool === "agencymem_complete_task" &&
    e.part.state?.status === "completed"
  );
}

export function buildWorker(opts: BuildOptions): Worker {
  const workerId = `build-${opts.n}`;
  const models = [`agencymem/${opts.buildModel}`, `fallback/${opts.fallbackModel}`];
  return {
    id: "build",
    worker: workerId,
    async once(session) {
      // Commits the hook logged while the gateway was down go first (contracts.md section 9). No
      // repository yet means no build commit yet; ensureRepo is the Test agent's job.
      // ponytail: build-1 alone replays, because two replays of one log in one process can drop
      // lines; a per-repository lock if replays ever need more than one worker.
      const repo = join(workspacesPath(opts.workspacesDir), session.projectId, "repo");
      if (opts.n === 1 && existsSync(join(repo, ".git"))) {
        await replayPending(repo, { gatewayUrl: opts.gatewayUrl, hookToken: opts.hookToken });
      }
      const { task } = await session.call("claim_task", {});
      if (!task) return "idle";

      let result!: RunResult;
      let model = models[0]!;
      let closedByRun = false;
      try {
        const tree = await ensureWorktree(session.projectId, task.key, {
          workspacesDir: opts.workspacesDir,
          install: opts.install,
        });
        await writeCardConfig(tree, task, {
          buildModel: opts.buildModel,
          fallbackModel: opts.fallbackModel,
        });
        for (model of models) {
          const events = forwardEvents((body) => session.step(body), task.id, tree);
          result = await runOpenCode({
            bin: opts.bin,
            tree,
            cardKey: task.key,
            taskId: task.id,
            model,
            env: {
              AM_PROJECT_ID: session.projectId,
              AM_WORKER_ID: workerId,
              GATEWAY_URL: opts.gatewayUrl,
              AM_HOOK_TOKEN: opts.hookToken,
              PORT: String(await freePort()),
            },
            heartbeat: () => session.call("heartbeat", { itemId: task.id }),
            heartbeatMs: opts.heartbeatMs,
            onEvent: (event) => {
              if (closedCard(event)) closedByRun = true;
              events.onEvent(event);
            },
          });
          await events.drain();
          // Only a provider that failed (an error or a stall) moves the card on to the fallback.
          const providerFailed = result.reason === "stall" || result.providerError !== null;
          if (closedByRun || !providerFailed || model === models.at(-1)) break;
          await session.step(finalStep(task.id, result, model));
        }
      } catch (e) {
        // The worktree or its files failed: the attempt fails with the reason.
        const reason = e instanceof Error ? e.message : String(e);
        return fail(session, task, `Setup failed: ${reason}`);
      }
      await session.step(finalStep(task.id, result, model));
      if (result.reason === "lease") return "stopped"; // another run takes the card
      // OpenCode closed the card itself (TD step 8): a second complete_task would only be refused.
      if (closedByRun) return "done";
      return finish(session, task, result, opts.pendingMs ?? PENDING_MS);
    },
  };
}

/**
 * agent-prompts.md section 11, worker steps 2 and 3: complete_task done (again while the tests
 * run), else failed with the reason. A card OpenCode already closed answers with a lease rejection.
 */
async function finish(
  session: Session,
  task: Card,
  result: RunResult,
  pendingMs: number,
): Promise<ItemResult> {
  let reason = "";
  for (let tries = 0; tries < PENDING_TRIES; tries++) {
    try {
      await session.call("complete_task", { taskId: task.id, version: task.version });
      return "done";
    } catch (e) {
      if (notOurs(e)) return "stopped";
      if (!(e instanceof ToolRejected)) throw e; // the gateway is down: the lease ends on its own
      reason = e.rejection.reason;
      if (e.reasonCode !== "RUN_PENDING") break;
      await sleep(pendingMs);
      // Up to 5 minutes of waiting: keep the lease (a refused beat means the card is not ours).
      try {
        await session.call("heartbeat", { itemId: task.id });
      } catch (beat) {
        if (notOurs(beat)) return "stopped";
        throw beat;
      }
    }
  }
  // A run that never got going says why; one that ran says what the evidence guard found.
  const ended = result.reason !== "exit" || result.providerError !== null;
  return fail(session, task, ended ? failureNote(result) : reason);
}

async function fail(session: Session, task: Card, note: string): Promise<ItemResult> {
  try {
    await session.call("complete_task", {
      taskId: task.id,
      version: task.version,
      outcome: "failed",
      note: note.slice(0, 500), // Task.note
    });
  } catch (e) {
    if (notOurs(e)) return "stopped";
    throw e;
  }
  return "failed";
}
