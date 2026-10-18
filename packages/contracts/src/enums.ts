// contracts.md section 3. Each enum is a zod schema and a type with the same name.
import { z } from "zod";

export const AgentId = z.enum([
  "intake",
  "discovery",
  "proposal",
  "architect",
  "planner",
  "test",
  "launch",
  "curator",
  "build",
]);
export type AgentId = z.infer<typeof AgentId>;

export const Mode = z.enum(["live", "demo"]);
export type Mode = z.infer<typeof Mode>;

export const Stage = z.enum([
  "intake",
  "discovery",
  "proposal",
  "design",
  "planning",
  "build",
  "e2e",
  "launch",
  "case_study",
  "closed",
]);
export type Stage = z.infer<typeof Stage>;

export const WorkItemKind = z.enum([
  "intake",
  "intake_answer",
  "discovery",
  "proposal",
  "change_request",
  "architect",
  "architect_revise",
  "planner",
  "replan",
  "write_tests",
  "test_run",
  "e2e",
  "merge",
  "launch",
  "curator",
  "ask", // a person's question on the Memory screen, answered by Discovery
]);
export type WorkItemKind = z.infer<typeof WorkItemKind>;

export const WorkItemStatus = z.enum(["open", "claimed", "done", "blocked", "cancelled"]);
export type WorkItemStatus = z.infer<typeof WorkItemStatus>;

export const Column = z.enum(["Backlog", "Ready", "In progress", "Testing", "Done", "Rework"]);
export type Column = z.infer<typeof Column>;

export const Lane = z.enum(["Frontend", "Backend", "UI", "Tests", "Deployment"]);
export type Lane = z.infer<typeof Lane>;

export const TaskKind = z.enum(["build"]);
export type TaskKind = z.infer<typeof TaskKind>;

export const GateKey = z.enum(["G1", "G2", "G3"]);
export type GateKey = z.infer<typeof GateKey>;

export const GateStatus = z.enum(["waiting", "approved", "rejected"]);
export type GateStatus = z.infer<typeof GateStatus>;

export const EpisodeKind = z.enum(["file_chunk", "answer", "human_edit", "change_request", "ask"]);
export type EpisodeKind = z.infer<typeof EpisodeKind>;

export const QuestionKind = z.enum(["contradiction", "open", "unclear"]);
export type QuestionKind = z.infer<typeof QuestionKind>;

export const QuestionStatus = z.enum(["open", "answered"]);
export type QuestionStatus = z.infer<typeof QuestionStatus>;

export const AssumptionStatus = z.enum(["open", "confirmed", "rejected"]);
export type AssumptionStatus = z.infer<typeof AssumptionStatus>;

export const ContradictionStatus = z.enum(["open", "resolved"]);
export type ContradictionStatus = z.infer<typeof ContradictionStatus>;

export const DocumentStatus = z.enum(["processing", "processed", "no_text", "failed"]);
export type DocumentStatus = z.infer<typeof DocumentStatus>;

export const Priority = z.enum(["must", "should", "could"]);
export type Priority = z.infer<typeof Priority>;

export const ChangeRequestStatus = z.enum(["open", "applied", "no_change", "needs_scope"]);
export type ChangeRequestStatus = z.infer<typeof ChangeRequestStatus>;

export const Doc = z.enum(["prd", "tdd", "plan"]);
export type Doc = z.infer<typeof Doc>;

export const DesignLabel = z.enum([
  "Decision",
  "Component",
  "Screen",
  "DataEntity",
  "Endpoint",
  "Risk",
]);
export type DesignLabel = z.infer<typeof DesignLabel>;

export const FeatureKind = z.enum([
  "content_page",
  "list_filter",
  "calendar",
  "form",
  "detail_action",
  "admin_crud",
  "auth",
  "notification",
]);
export type FeatureKind = z.infer<typeof FeatureKind>;

export const ClarityBand = z.enum(["low", "medium", "high"]);
export type ClarityBand = z.infer<typeof ClarityBand>;

/** Which model endpoint answered. Not the Endpoint design node (that is `EndpointNode`). */
export const Endpoint = z.enum(["primary", "openrouter"]);
export type Endpoint = z.infer<typeof Endpoint>;

export const GuardName = z.enum([
  "tenancy",
  "ownership",
  "gate",
  "source",
  "version",
  "lease",
  "evidence",
  "deps",
  "read-only",
  "anonymity",
]);
export type GuardName = z.infer<typeof GuardName>;

export const HttpMethod = z.enum(["GET", "POST", "PATCH", "DELETE"]);
export type HttpMethod = z.infer<typeof HttpMethod>;
