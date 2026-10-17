// The OpenCode runner (technical design "Build loop and OpenCode", steps 4 and 5): one
// `opencode run` process per card in its worktree, its JSON events read line by line, a heartbeat
// while it runs, and a stop on lease loss, timeout or stall. The caller picks the model; the build
// worker runs a card on TokenHarbor, then once on OpenCode Zen when that run ends on a provider
// error or a stall (developer decision, 2026-10-18). A run that still fails ends as one failed
// attempt (failureNote), and 2 failed attempts block the card (claim_task skips it).
import { execFile, spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { ConfigSchema } from "@agencymem/contracts";
import { leaseLost } from "./loop";

const run = promisify(execFile);
const win = process.platform === "win32";
// ponytail: a constant, not an env var; add BUILD_TIMEOUT_MS to the config when a run needs more.
const TIMEOUT_MS = 30 * 60_000;
/**
 * OpenCode does not exit when the provider sends an empty stream: it repeats step_finish with
 * reason "unknown" and no tokens (the 4.1 spike). This many in a row count as a stalled provider.
 */
const STALL_STEPS = 5;

export type RunEnd = "exit" | "lease" | "timeout" | "stall" | "spawn";
export type RunResult = {
  reason: RunEnd;
  exitCode: number | null;
  ms: number;
  tokens: { input: number; output: number };
  /** OpenCode's `error` event after its own retries gave up (HTTP 429, 5xx, a network error). */
  providerError: { status: number | null } | null;
};

/** The variables the worker gives each run, on top of its own environment (which holds the keys). */
export type RunEnv = {
  AM_PROJECT_ID: string;
  AM_WORKER_ID: string;
  GATEWAY_URL: string;
  AM_HOOK_TOKEN: string;
  PORT: string;
};

/**
 * The command that starts OpenCode. On Windows `opencode` is opencode.cmd, which needs a shell; a
 * shell splits the prompt on spaces and a kill stops only the shell, so the worker starts the
 * opencode.exe the npm package ships, directly.
 */
export async function opencodeBin(): Promise<string[]> {
  if (!win) return ["opencode"];
  const root = (await run("npm", ["root", "-g"], { shell: true })).stdout.trim();
  return [join(root, "opencode-ai", "bin", "opencode.exe")];
}

/** Refuses to start when the installed OpenCode is not OPENCODE_VERSION (its events can change). */
export async function checkOpenCodeVersion(bin: string[], expected: string): Promise<void> {
  const [cmd, ...pre] = bin as [string, ...string[]];
  const installed = (await run(cmd, [...pre, "--version"])).stdout.trim();
  if (installed !== expected) {
    throw new Error(`OpenCode ${installed} is installed; OPENCODE_VERSION is ${expected}.`);
  }
}

type StepFinish = {
  type?: string;
  part?: { reason?: string; tokens?: { input?: number; output?: number } };
  // ponytail: only the status is kept; the provider's message and body never reach a note or a log.
  error?: { name?: string; data?: { statusCode?: number } };
};

/**
 * AgencyMem settings OpenCode needs: opencode.json reads the keys and the gateway address, and
 * the post-commit hook posts with the hook token. Every other config variable (AM_UI_TOKEN,
 * FALKORDB_URL ...) is left out, because the model can print its environment through npm.
 */
const OPENCODE_NEEDS = new Set([
  "TOKENHARBOR_API_KEY",
  "ZEN_API_KEY",
  "AM_AGENT_TOKEN",
  "GATEWAY_URL",
  "AM_HOOK_TOKEN",
]);

/** The run's environment: the worker's, minus the config it does not need, plus `env`. */
function runEnv(env: RunEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(ConfigSchema.shape)) {
    if (!OPENCODE_NEEDS.has(name)) delete out[name];
  }
  // Without OPENCODE_DISABLE_CLAUDE_CODE OpenCode also loads ~/.claude/CLAUDE.md and its skills.
  return { ...out, ...env, OPENCODE_DISABLE_CLAUDE_CODE: "1" };
}

/** Runs OpenCode on one card until it exits or is stopped. Never throws for the run itself. */
export async function runOpenCode(opts: {
  bin: string[];
  tree: string;
  cardKey: string;
  taskId: string;
  model: string;
  env: RunEnv;
  heartbeat: () => Promise<unknown>;
  heartbeatMs: number;
  timeoutMs?: number;
  onEvent?: (event: unknown) => void;
}): Promise<RunResult> {
  const started = Date.now();
  const [cmd, ...pre] = opts.bin as [string, ...string[]];
  const args = ["run", "--dir", opts.tree, "--model", opts.model, "--format", "json", "--auto"];
  const prompt = `Build card ${opts.cardKey} (taskId ${opts.taskId}). Follow AGENTS.md. Start with get_task_context.`;
  const child = spawn(cmd, [...pre, ...args, prompt], {
    env: runEnv(opts.env),
    stdio: ["ignore", "pipe", "ignore"],
    detached: !win, // its own process group on POSIX, so a stop reaches what OpenCode started
  });

  let end: RunEnd = "exit";
  let exited = false;
  /** Ends OpenCode and every process it started (a test run, a dev server on PORT). */
  const killTree = () => {
    if (!child.pid) return;
    if (win) {
      if (exited) return; // taskkill finds the tree through a living parent only
      // taskkill /T ends the tree; if taskkill itself cannot start, kill OpenCode alone.
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]).on("error", () => child.kill());
      return;
    }
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // the group is already gone
    }
  };
  const stop = (why: RunEnd) => {
    if (end !== "exit" || exited) return;
    end = why;
    clearInterval(beat);
    if (win) return killTree();
    try {
      process.kill(-child.pid!, "SIGTERM");
    } catch {
      // the group is already gone
    }
    setTimeout(killTree, 5_000).unref(); // a process that ignores SIGTERM
  };

  const tokens = { input: 0, output: 0 };
  let providerError: RunResult["providerError"] = null;
  let empty = 0;
  createInterface({ input: child.stdout }).on("line", (line) => {
    let event: StepFinish;
    try {
      event = JSON.parse(line) as StepFinish;
    } catch {
      return; // not an event
    }
    try {
      opts.onEvent?.(event);
    } catch {
      // a listener's bug must not stop the run or the runner
    }
    if (event.type === "error" && event.error?.name === "APIError") {
      providerError = { status: event.error.data?.statusCode ?? null };
    }
    if (event.type !== "step_finish") return;
    const t = event.part?.tokens;
    tokens.input += t?.input ?? 0;
    tokens.output += t?.output ?? 0;
    empty = event.part?.reason === "unknown" && !t?.input && !t?.output ? empty + 1 : 0;
    if (empty >= STALL_STEPS) stop("stall");
  });

  let beating: Promise<unknown> = Promise.resolve();
  const beat = setInterval(() => {
    beating = opts.heartbeat().catch((e: unknown) => {
      // The lease ended or went to another worker: stop at once (contracts.md, heartbeat). Any
      // other failure is a blip; the lease outlives several missed beats.
      if (leaseLost(e)) stop("lease");
    });
  }, opts.heartbeatMs);
  const timer = setTimeout(() => stop("timeout"), opts.timeoutMs ?? TIMEOUT_MS);

  const exitCode = await new Promise<number | null>((done) => {
    child.on("spawn", () => {
      child.on("exit", (code) => {
        exited = true;
        // Normally stdout closes right after; a leftover child holding it must not hang the run.
        setTimeout(() => done(code), 3_000).unref();
      });
      child.on("close", (code) => done(code));
    });
    // Only a failed start emits "error" before "spawn"; a failed kill later is not an exit.
    child.once("error", () => {
      if (child.pid === undefined) {
        end = "spawn";
        done(null);
      }
    });
  });
  clearInterval(beat);
  clearTimeout(timer);
  killTree(); // leftovers whose parent already exited
  // The worker's complete_task comes next: no beat may land after it clears the lease.
  await beating;
  return { reason: end, exitCode, ms: Date.now() - started, tokens, providerError };
}

/** The note on a failed attempt: why a run ended without complete_task (the card's note). */
export function failureNote(result: RunResult): string {
  if (result.providerError) {
    const status = result.providerError.status;
    return `Provider error (${status === null ? "no HTTP status" : `HTTP ${status}`}).`;
  }
  switch (result.reason) {
    case "timeout":
      return `The run passed its ${TIMEOUT_MS / 60_000}-minute limit.`;
    case "stall":
      return "The provider sent only empty replies.";
    case "spawn":
      return "OpenCode did not start.";
    case "lease":
      return "The lease ended.";
    case "exit":
      return `OpenCode exited (code ${result.exitCode}) without calling complete_task.`;
  }
}
