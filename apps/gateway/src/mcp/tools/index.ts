import type { ToolInput, ToolName } from "@agencymem/contracts";
import { claimItemTool } from "./claim-item";
import { claimTaskTool } from "./claim-task";
import { completeItemTool } from "./complete-item";
import { completeTaskTool } from "./complete-task";
import type { Outcome, ToolCtx } from "./common";
import { findImpactTool } from "./find-impact";
import { getTaskContextTool } from "./get-task-context";
import { heartbeatTool } from "./heartbeat";
import { readQueryTool } from "./read-query";
import { recordChangeRequestTool } from "./record-change-request";
import { recallContextTool } from "./recall-context";
import { recorded } from "./recalled";
import { submitTestRunTool } from "./submit-test-run";
import { writeCardsTool } from "./write-cards";
import { writeCaseStudyTool } from "./write-case-study";
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
  get_task_context: recorded("get_task_context", getTaskContextTool, (i) => i.taskId),
  heartbeat: heartbeatTool,
  complete_item: completeItemTool,
  complete_task: completeTaskTool,
  recall_context: recorded("recall_context", recallContextTool, (i) => i.itemId),
  write_handoff: writeHandoffTool,
  write_fact: writeFactTool,
  write_question: writeQuestionTool,
  write_product: writeProductTool,
  record_change_request: recordChangeRequestTool,
  write_design: writeDesignTool,
  write_cards: writeCardsTool,
  write_tests: writeTestsTool,
  submit_test_run: submitTestRunTool,
  write_case_study: writeCaseStudyTool,
  find_impact: findImpactTool,
  read_query: readQueryTool,
};
