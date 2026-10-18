// Edge names: the technical design edge table plus the two edges contracts.md section 4 adds.
import { z } from "zod";

export const EdgeType = z.enum([
  "PART_OF", // Episode → Document
  "SOURCED_FROM", // Fact → Episode
  "ABOUT", // Fact → Entity
  "SUPERSEDES", // new Fact → old Fact
  "BETWEEN", // Contradiction → Fact (2 or more)
  "RAISED_ON", // Question → Fact or Contradiction
  "ASSUMES", // Question → Assumption
  "ANSWERS", // answer Episode → Question
  "RESOLVED_BY", // Assumption → answer Episode
  "DERIVED_FROM", // Requirement → Fact; design node → Requirement
  "HAS_REQUIREMENT", // Feature → Requirement
  "FOR", // Estimate → Feature
  "OF", // AcceptanceCriterion → Requirement
  "RENDERS", // DocSection → any product or design node
  "IMPLEMENTS", // Task → Requirement
  "USES", // Task → design node
  "HAS_CRITERION", // Task → AcceptanceCriterion
  "DEPENDS_ON", // Task → Task
  "VERIFIES", // TestCase → AcceptanceCriterion
  "RUNS", // TestRun → TestCase
  "FOR_TASK", // CodeChange → Task
  "FROM", // ChangeRequest → change-request Episode
  "ENDS", // ChangeRequest → old Fact
  "FLAGGED_BY", // Task or DocSection → ChangeRequest
  "RECALLED", // WorkItem or Task → a node its recall_context or get_task_context answer named
]);
export type EdgeType = z.infer<typeof EdgeType>;
