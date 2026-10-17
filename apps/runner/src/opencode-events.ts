// OpenCode's JSON events as short Run steps for the board (technical design "What the board shows
// from the run"). The one place that knows OpenCode's event format, which is why the runner pins
// OPENCODE_VERSION. Shapes as seen on 1.18.32: { type, timestamp, sessionID, part }. Raw model
// text and tool output are never sent.
import { basename, isAbsolute, relative } from "node:path";
import { PRICES, costOf, type Prices } from "@agencymem/llm";
import type { StepBody } from "./mcp-client";
import type { RunResult } from "./opencode";

export type Step = { step: string; text: string };

/** Route 30 takes at most 200 characters of text; a longer step would be refused and lost. */
const cut = (text: string) => (text.length > 200 ? `${text.slice(0, 199)}…` : text);

type ToolPart = {
  tool?: string;
  state?: {
    status?: string;
    input?: { command?: string; filePath?: string };
    error?: string;
    metadata?: { exit?: number };
  };
};

/** The code of a gateway rejection inside a tool error, or null for any other error. */
function rejectionCode(error: string | undefined): string | null {
  try {
    const body = JSON.parse(error ?? "") as {
      error?: { code?: string; details?: { reasonCode?: string } };
    };
    return body.error?.details?.reasonCode ?? body.error?.code ?? null;
  } catch {
    return null;
  }
}

/** Tools whose second word names what they do (`npm test`, `git commit`). */
const SUBCOMMANDS = new Set(["npm", "npx", "pnpm", "yarn", "git"]);

/**
 * A command's name, never its arguments: leading `NAME=value` words (which can hold a key) are
 * dropped, a path is cut to its last part, and a second word is kept only for SUBCOMMANDS.
 */
function commandName(command: string): string {
  const words = command.trim().split(/\s+/);
  while (words.length > 0 && /^[A-Za-z_]\w*=/.test(words[0]!)) words.shift();
  if (words.length === 0) return "a command"; // only assignments: show none of them
  const first = basename(words[0]!);
  const second = words[1];
  return SUBCOMMANDS.has(first) && second && /^[a-z][a-z0-9:-]*$/.test(second)
    ? `${first} ${second}`
    : first;
}

/** A file as the board shows it: relative to the worktree, or its name alone when outside it. */
function shownPath(path: string, tree: string): string {
  if (!isAbsolute(path)) return path.replaceAll("\\", "/");
  const rel = relative(tree, path);
  return rel.startsWith("..") || isAbsolute(rel) ? basename(path) : rel.replaceAll("\\", "/");
}

/** One OpenCode event as a Run step, or null when the board shows nothing for it. */
export function mapEvent(event: unknown, tree: string): Step | null {
  const e = event as { type?: string; part?: ToolPart } | null;
  if (typeof e !== "object" || e === null || e.type !== "tool_use") return null;
  const { tool = "", state = {} } = e.part ?? {};

  if (tool.startsWith("agencymem_")) {
    const name = tool.slice("agencymem_".length);
    if (state.status !== "error") return { step: "tool", text: `Called ${name}` };
    const code = rejectionCode(state.error);
    return { step: "tool", text: code ? `${name} rejected: ${code}` : `${name} failed` };
  }
  if (tool === "edit" || tool === "write") {
    return {
      step: "edit",
      text: cut(`Edited ${shownPath(state.input?.filePath ?? "a file", tree)}`),
    };
  }
  if (tool === "bash" && state.input?.command) {
    const exit = state.metadata?.exit;
    const failed = exit !== undefined && exit !== 0 ? ` (exit ${exit})` : "";
    return { step: "bash", text: `Ran ${commandName(state.input.command)}${failed}` };
  }
  return null; // read, glob, grep, todos ...: too fine-grained for the board
}

const ENDED: Record<RunResult["reason"], string> = {
  exit: "Run finished",
  lease: "Stopped: the lease ended",
  timeout: "Stopped: timed out",
  stall: "Stopped: the provider sent nothing",
  spawn: "Stopped: OpenCode did not start",
};

/**
 * The run's last step. `final: true` makes the gateway write the run's one Run node, with the token
 * totals (agent-prompts.md section 11, worker step 1). `model` is OpenCode's provider/model.
 */
export function finalStep(
  itemId: string,
  result: RunResult,
  model: string,
  prices: Prices = PRICES,
): StepBody {
  const seconds = Math.round(result.ms / 1000);
  const text =
    result.reason === "spawn"
      ? ENDED.spawn
      : result.reason === "exit"
        ? `${ENDED.exit} (exit ${result.exitCode}, ${seconds} s)`
        : `${ENDED[result.reason]} (${seconds} s)`;
  const slash = model.indexOf("/");
  const id = model.slice(slash + 1);
  return {
    itemId,
    step: "exit",
    text,
    model: id,
    endpoint: model.startsWith("fallback/") ? "openrouter" : "primary",
    tokensIn: result.tokens.input,
    tokensOut: result.tokens.output,
    ms: result.ms,
    // OpenCode reports cost 0 on an openai-compatible provider, so the meter's table prices it.
    cost: costOf(prices, id, result.tokens.input, result.tokens.output) ?? 0,
    final: true,
  };
}

/**
 * An onEvent for runOpenCode: each mapped event goes to the gateway as a step of the card, one
 * post at a time, so the board gets them in order. Await `drain()` before the final step.
 */
export function forwardEvents(
  post: (body: StepBody) => Promise<void>,
  itemId: string,
  tree: string,
): { onEvent: (event: unknown) => void; drain: () => Promise<void> } {
  let queue = Promise.resolve();
  return {
    onEvent: (event) => {
      const step = mapEvent(event, tree);
      if (step) queue = queue.then(() => post({ itemId, ...step })); // post never throws
    },
    drain: () => queue,
  };
}
