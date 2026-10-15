// The agent folder pattern (agent-prompts.md section 1): each model agent is a folder with
// prompt.md (its own rules), output.ts (the zod schema of the model's JSON) and agent.ts, which
// exports an Agent: what part of recall_context the model sees, and the MCP calls made from its JSON.
import { readFile } from "node:fs/promises";
import type { z } from "zod";
import type { AgentId, WorkItemKind } from "@agencymem/contracts";
import type { Tier } from "@agencymem/llm";
import type { Session, ToolOut } from "./mcp-client";

export type Recall = ToolOut<"recall_context">;

/** What act() may do: call MCP tools, and post one run step text per call ("Wrote 14 facts"). */
export type Act = { call: Session["call"]; say(text: string): Promise<void> };

/** `summary` is the handoff text; `outputIds` are the nodes the item wrote. */
export type ActResult = { outputIds: string[]; summary: string };

export type Agent<O> = {
  id: AgentId;
  /** The work item kinds this agent claims. */
  kinds: WorkItemKind[];
  tier: Tier;
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
  /** Reference errors: an id or key in the output that is not in the context. */
  check?(output: O, recall: Recall): string[];
  act(output: O, recall: Recall, act: Act): Promise<ActResult>;
};

const PREAMBLE = new URL("./agents/preamble.md", import.meta.url);

/** The system prompt of the agent whose agent.ts is at `agentUrl`: preamble, then its prompt.md. */
export async function loadPrompt(agentUrl: string, name: string): Promise<string> {
  const preamble = await readFile(PREAMBLE, "utf8");
  const own = await readFile(new URL("./prompt.md", agentUrl), "utf8");
  return `${preamble.replace("<Agent>", name).trimEnd()}\n\n${own.trim()}\n`;
}
