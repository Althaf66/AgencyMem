// The ownership table (technical design "Ownership") and the work item kinds each agent claims
// (stage-machine.md section 3).
import type { AgentId, NodeLabel, ToolName, WorkItemKind } from "@agencymem/contracts";
import { reject, type GuardResult } from "./run";

/** The node labels each agent may write. Build writes no node directly: commits come by the hook. */
export const OWNS: Record<AgentId, NodeLabel[]> = {
  intake: ["Fact", "Entity"],
  discovery: ["Question", "Contradiction", "Assumption"],
  proposal: ["Requirement", "Feature", "Estimate", "Fact"], // Fact: superseding facts from a CR
  architect: ["Decision", "Component", "Screen", "DataEntity", "Endpoint", "Risk", "DocSection"],
  planner: ["Task", "AcceptanceCriterion"],
  test: ["TestCase", "TestRun"],
  launch: ["ReadinessReport"], // C8
  build: [],
  maintenance: ["Defect", "Task"], // Task: fix cards
  curator: ["CaseStudy", "Lesson", "EstimateRecord"],
};

/** The work item kinds each agent claims. */
export const CLAIMS: Record<AgentId, WorkItemKind[]> = {
  intake: ["intake", "intake_answer"],
  discovery: ["discovery"],
  proposal: ["proposal", "change_request"],
  architect: ["architect", "architect_revise"],
  planner: ["planner", "replan"],
  test: ["write_tests", "test_run", "e2e"],
  launch: ["launch"],
  build: ["merge"],
  maintenance: ["maintenance"],
  curator: ["curator"],
};

/**
 * The labels each tool with an ownership guard writes, as the ownership table names them
 * (contracts.md section 7). Side effects the table does not list are left out: propose_fix also
 * writes the fix card's criteria and gate G6, record_change_request also flags cards and sections.
 */
export const TOOL_WRITES: Partial<Record<ToolName, NodeLabel[]>> = {
  write_handoff: [], // plus ReadinessReport when a report is sent
  write_fact: ["Fact", "Entity"],
  write_question: ["Question", "Contradiction", "Assumption"],
  write_product: ["Requirement", "Feature", "Estimate"],
  record_change_request: ["Fact"],
  write_design: ["Decision", "Component", "Screen", "DataEntity", "Endpoint", "Risk", "DocSection"],
  write_cards: ["Task", "AcceptanceCriterion"],
  write_tests: ["TestCase"],
  submit_test_run: ["TestRun"],
  report_defect: ["Defect"],
  propose_fix: ["Task"],
  write_case_study: ["CaseStudy", "EstimateRecord", "Lesson"],
};

/**
 * The item kinds each write tool is for: the "Done when the agent has called" column of
 * stage-machine.md section 3. Owning a tool's labels is not enough (intake owns Fact, planner owns
 * Task); the item must also be one the tool belongs to. write_handoff serves many kinds: any kind
 * the agent claims will do.
 */
export const TOOL_KINDS: Partial<Record<ToolName, WorkItemKind[]>> = {
  write_fact: ["intake", "intake_answer"],
  write_question: ["discovery"],
  write_product: ["proposal", "change_request"],
  record_change_request: ["change_request"],
  write_design: ["architect", "architect_revise"],
  write_cards: ["planner", "replan"],
  write_tests: ["write_tests"],
  submit_test_run: ["test_run", "e2e"],
  report_defect: ["maintenance"],
  propose_fix: ["maintenance"],
  write_case_study: ["curator"],
};

export type Caller = { kind: "agent"; agent: AgentId } | { kind: "ui" };

/**
 * Rejects a tool call that writes a label the agent does not own, or works on an item of a kind
 * the agent does not claim. A UI session may call only read_query (contracts.md section 7).
 */
export function ownership(
  caller: Caller,
  tool: ToolName,
  opts: { itemKind?: WorkItemKind; labels?: NodeLabel[] } = {},
): GuardResult | null {
  if (caller.kind === "ui") {
    if (tool === "read_query") return null;
    return reject("ownership", "LABEL_NOT_OWNED", "A UI session may call only read_query.", {
      tool,
    });
  }
  const owned = OWNS[caller.agent];
  const label = [...(TOOL_WRITES[tool] ?? []), ...(opts.labels ?? [])].find(
    (l) => !owned.includes(l),
  );
  if (label) {
    return reject("ownership", "LABEL_NOT_OWNED", `${caller.agent} may not write ${label}.`, {
      label,
    });
  }
  const forKinds = TOOL_KINDS[tool];
  if (forKinds && !(opts.itemKind && forKinds.includes(opts.itemKind))) {
    return reject(
      "ownership",
      "ITEM_KIND_NOT_OWNED",
      `${tool} is for ${forKinds.join(" or ")} items, not ${opts.itemKind ?? "this item"}.`,
      { kind: opts.itemKind ?? null },
    );
  }
  if (opts.itemKind && !CLAIMS[caller.agent].includes(opts.itemKind)) {
    return reject(
      "ownership",
      "ITEM_KIND_NOT_OWNED",
      `${caller.agent} does not work on ${opts.itemKind} items.`,
      { kind: opts.itemKind },
    );
  }
  return null;
}
