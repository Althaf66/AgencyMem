import type { ToolInput, ToolName } from "@agencymem/contracts";
import { claimItemTool } from "./claim-item";
import { completeItemTool } from "./complete-item";
import type { Outcome, ToolCtx } from "./common";
import { findImpactTool } from "./find-impact";
import { heartbeatTool } from "./heartbeat";
import { readQueryTool } from "./read-query";
import { recallContextTool } from "./recall-context";
import { writeFactTool } from "./write-fact";
import { writeQuestionTool } from "./write-question";
import { writeHandoffTool } from "./write-handoff";

export type { Outcome, ToolCtx } from "./common";

type Handler<K extends ToolName> = (ctx: ToolCtx, input: ToolInput<K>) => Promise<Outcome<unknown>>;

/** The tools built so far. The others answer "not built yet" until their task. */
export const HANDLERS: { [K in ToolName]?: Handler<K> } = {
  claim_item: claimItemTool,
  heartbeat: heartbeatTool,
  complete_item: completeItemTool,
  recall_context: recallContextTool,
  write_handoff: writeHandoffTool,
  write_fact: writeFactTool,
  write_question: writeQuestionTool,
  find_impact: findImpactTool,
  read_query: readQueryTool,
};
