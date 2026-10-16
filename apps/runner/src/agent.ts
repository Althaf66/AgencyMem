// The agent folder pattern (agent-prompts.md section 1): each model agent is a folder with
// prompt.md (its own rules), output.ts (the zod schema of the model's JSON) and agent.ts, which
// exports an Agent: what part of recall_context the model sees, and the MCP calls made from its JSON.
import { readFile } from "node:fs/promises";
import type { z } from "zod";
import type { AgentId, WorkItemKind } from "@agencymem/contracts";
import type { Tier } from "@agencymem/llm";
import type { Session, ToolIn, ToolOut } from "./mcp-client";

export type Recall = ToolOut<"recall_context">;

/** What act() may do: call MCP tools, and post one run step text per call ("Wrote 14 facts"). */
export type Act = {
  call: Session["call"];
  say(text: string): Promise<void>;
  /** True once the item's lease is lost: a job must stop before it writes anything more. */
  lost?(): boolean;
};

/** A merge item's result for complete_item (contracts.md section 7). */
export type MergeResult = NonNullable<ToolIn<"complete_item">["result"]>;

/** `summary` is the handoff text; `outputIds` are the nodes the item wrote. */
export type ActResult = { outputIds: string[]; summary: string; result?: MergeResult };

export type Agent<O> = {
  id: AgentId;
  /** The X-AM-Worker id; `<id>-1` when not set. An agent with two loops gives the second its own. */
  worker?: string;
  /** The work item kinds this agent claims. */
  kinds: WorkItemKind[];
  tier: Tier;
  /** The reply limit; 4,000 tokens when not set (agent-prompts.md section 1, Model request). */
  maxTokens?: number;
  /** The TASK line of the user message; a function when it depends on the item (a revision). */
  task: string | ((recall: Recall) => string);
  /** The system prompt: the shared preamble, then prompt.md. */
  prompt: string;
  output: z.ZodType<O>;
  /** The item kinds that write a handoff (stage-machine.md section 3): intake does, intake_answer
   * does not. */
  handoff: WorkItemKind[];
  /** The part of recall_context sent to the model as CONTEXT. */
  select(recall: Recall): unknown;
  /** Reference errors: an id or key in the output that is not in the context. A check that needs
   * I/O (the Test agent lists its spec files) returns a Promise. */
  check?(output: O, recall: Recall): string[] | Promise<string[]>;
  act(output: O, recall: Recall, act: Act): Promise<ActResult>;
};

const PREAMBLE = new URL("./agents/preamble.md", import.meta.url);

/**
 * The system prompt of the agent whose agent.ts is at `agentUrl`: preamble, then its prompt.md (or
 * `file`, for an agent with a second item kind and its own rules).
 */
export async function loadPrompt(
  agentUrl: string,
  name: string,
  file = "prompt.md",
): Promise<string> {
  const preamble = await readFile(PREAMBLE, "utf8");
  const own = await readFile(new URL(`./${file}`, agentUrl), "utf8");
  return `${preamble.replace("<Agent>", name).trimEnd()}\n\n${own.trim()}\n`;
}

/**
 * An agent step with no model (agent-prompts.md section 1, Tiers: the Test agent's test_run, the
 * rule-based Launch agent): the same claim, recall, heartbeat and complete as a model agent, with
 * `run` in place of think and act.
 */
export type Job = {
  id: AgentId;
  worker?: string;
  kinds: WorkItemKind[];
  handoff: WorkItemKind[];
  run(recall: Recall, act: Act): Promise<ActResult>;
};

/** A job's own failure (Playwright gave no report): the item fails with this message as its note. */
export class JobFailed extends Error {
  override name = "JobFailed";
  /** A merge conflict's files, sent with the failure. */
  constructor(
    message: string,
    readonly result?: MergeResult,
  ) {
    super(message);
  }
}
