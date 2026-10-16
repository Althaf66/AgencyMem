import type { ToolInput, ToolName } from "@agencymem/contracts";
import { claimItemTool } from "./claim-item";
import { claimTaskTool } from "./claim-task";
import { completeItemTool } from "./complete-item";
import type { Outcome, ToolCtx } from "./common";
import { findImpactTool } from "./find-impact";
import { heartbeatTool } from "./heartbeat";
import { readQueryTool } from "./read-query";
import { recordChangeRequestTool } from "./record-change-request";
import { recallContextTool } from "./recall-context";
import { writeCardsTool } from "./write-cards";
import { writeDesignTool } from "./write-design";
import { writeFactTool } from "./write-fact";
import { writeQuestionTool } from "./write-question";
import { writeTestsTool } from "./write-tests";
import { writeHandoffTool } from "./write-handoff";
import { writeProductTool } from "./write-product";

export type { Outcome, ToolCtx } from "./common";

type Handler<K extends ToolName> = (ctx: ToolCtx, input: ToolInput<K>) => Promise<Outcome<unknown>>;

/** The tools built so far. The others answer "not built yet" until their task. */
export const HANDLERS: { [K in ToolName]?: Handler<K> } = {
  claim_item: claimItemTool,
  claim_task: claimTaskTool,
  heartbeat: heartbeatTool,
  complete_item: completeItemTool,
  recall_context: recallContextTool,
  write_handoff: writeHandoffTool,
  write_fact: writeFactTool,
  write_question: writeQuestionTool,
  write_product: writeProductTool,
  record_change_request: recordChangeRequestTool,
  write_design: writeDesignTool,
  write_cards: writeCardsTool,
  write_tests: writeTestsTool,
  find_impact: findImpactTool,
  read_query: readQueryTool,
};
