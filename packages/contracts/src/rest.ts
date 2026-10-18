// contracts.md sections 8 (REST routes) and 9 (git hook route). Route numbers match the spec.
// Snapshot responses (S) carry `seq`, the last event the snapshot reflects (C12).
import { z } from "zod";
import {
  Actor,
  CardKey,
  Count,
  CrKey,
  CriterionKey,
  EpochMs,
  FeatureKey,
  GraphView,
  Id,
  ProjectInfo,
  ReadinessCheck,
  RequirementKey,
  Sha,
  text,
} from "./common";
import { EdgeType } from "./edges";
import { Envelope, eventData } from "./events";
import {
  AgentId,
  AssumptionStatus,
  ClarityBand,
  Column,
  ContradictionStatus,
  Doc,
  DocumentStatus,
  Endpoint,
  FeatureKind,
  GateKey,
  GateStatus,
  Lane,
  Mode,
  QuestionKind,
  QuestionStatus,
  Stage,
  TaskKind,
  WorkItemKind,
  WorkItemStatus,
} from "./enums";
import { Episode, NodeLabel, WorkItem } from "./nodes";
import { ReadQueryInput, ReadQueryOutput } from "./tools";

const Seq = Count;
const Version = z.int().min(1);

// Body types

export const DocumentInfo = z.object({
  id: Id,
  name: z.string(),
  mime: z.string(),
  status: DocumentStatus,
  episodeCount: Count,
  wordCount: Count,
  error: z.string().nullable(),
  uploadedAt: EpochMs,
});
export type DocumentInfo = z.infer<typeof DocumentInfo>;

const AssumptionView = z.object({ id: Id, text: z.string(), status: AssumptionStatus });

export const QuestionView = z.object({
  id: Id,
  kind: QuestionKind,
  text: z.string(),
  recommended: z.string(),
  reasoning: z.string(),
  approach: z.string(),
  status: QuestionStatus,
  version: Version,
  assumption: AssumptionView,
  contradiction: z.object({ id: Id, summary: z.string(), status: ContradictionStatus }).nullable(),
  sources: z.array(
    z.object({
      episodeId: Id,
      factId: Id,
      factStatement: z.string(),
      documentName: z.string().nullable(),
      page: z.int().nullable(),
      lineStart: z.int().nullable(),
      lineEnd: z.int().nullable(),
      text: z.string(),
    }),
  ),
  answer: z.object({ episodeId: Id, text: z.string(), actor: Actor, at: EpochMs }).nullable(),
});
export type QuestionView = z.infer<typeof QuestionView>;

export const GateView = z.object({
  id: Id,
  key: GateKey,
  status: GateStatus,
  version: Version,
  decidedBy: Actor.nullable(),
  decidedAt: EpochMs.nullable(),
  reason: z.string().nullable(),
  canDecide: z.boolean(),
  blockedBy: z.array(z.string()),
});
export type GateView = z.infer<typeof GateView>;

export const CardView = z.object({
  id: Id,
  key: CardKey,
  title: z.string(),
  description: z.string(),
  lane: Lane,
  column: Column,
  order: z.int(),
  kind: TaskKind,
  version: Version,
  attempts: Count,
  blocked: z.boolean(),
  note: z.string().nullable(),
  leaseHolder: z.string().nullable(),
  leaseUntil: EpochMs.nullable(),
  testStatus: z.enum(["none", "pending", "passing", "failing"]),
  commits: z.array(
    z.object({ sha: Sha, message: z.string(), committedAt: EpochMs, linked: z.boolean() }),
  ),
  rework: z.boolean(),
  crIds: z.array(Id),
  crKeys: z.array(CrKey), // the same CRs, in the same order
  requirementKey: RequirementKey,
  dependsOn: z.array(CardKey),
  criteria: z.array(
    z.object({
      id: Id,
      key: CriterionKey,
      text: z.string(),
      testIds: z.array(z.string()),
      testCaseCount: Count,
    }),
  ),
  mergedSha: Sha.nullable(),
});
export type CardView = z.infer<typeof CardView>;

/** The agent strip above the board: open, claimed or blocked items, plus the 5 most recently done. */
export const ItemView = z.object({
  id: Id,
  kind: WorkItemKind,
  agent: AgentId,
  status: WorkItemStatus,
  leaseOwner: z.string().nullable(),
  leaseUntil: EpochMs.nullable(),
  attempts: Count,
  lastStep: z.string().nullable(),
  doneAt: EpochMs.nullable(),
});
export type ItemView = z.infer<typeof ItemView>;

const Ratio = z.object({ covered: Count, total: Count });

export const ProgressView = z.object({
  stage: Stage,
  gates: z.array(z.object({ key: GateKey, status: GateStatus })),
  lanes: z.array(z.object({ lane: Lane, done: Count, total: Count })),
  coverage: Ratio, // requirements with a passing run
  openAssumptions: Count,
  seq: Seq,
});
export type ProgressView = z.infer<typeof ProgressView>;

const LessonView = z.object({
  id: Id,
  featureKind: FeatureKind,
  clarityBand: ClarityBand,
  ratio: z.number(),
  n: Count,
});

export const FeatureView = z.object({
  id: Id,
  key: FeatureKey,
  name: z.string(),
  featureKind: FeatureKind,
  productVersion: Count,
  requirementKeys: z.array(RequirementKey),
  actualHours: z.number().nullable(),
  estimate: z.object({
    hours: z.number(),
    rawHours: z.number(),
    basis: z.string(),
    lessons: z.array(LessonView.extend({ text: z.string(), projectIds: z.array(Id) })),
  }),
});
export type FeatureView = z.infer<typeof FeatureView>;

export const ProjectMetrics = z.object({
  estimateError: z.number().nullable(),
  questions: Count,
  contradictions: Count,
  changeRequests: Count,
  cardsReopened: Count,
  cardsReopenedPerCR: z.number().nullable(),
  rejected: z.object({ writes: Count, claims: Count, completions: Count, queries: Count }),
  coverage: Ratio,
  tokensIn: Count,
  tokensOut: Count,
  cost: z.number().nonnegative(),
  /** The model calls by agent and model, priced from the meter's table (null: no price). */
  models: z.array(
    z.object({
      agent: z.string(),
      model: z.string(),
      runs: Count,
      tokensIn: Count,
      tokensOut: Count,
      cost: z.number().nonnegative(),
      price: z
        .object({ inPerMillion: z.number().nonnegative(), outPerMillion: z.number().nonnegative() })
        .nullable(),
    }),
  ),
  seq: Seq,
});
export type ProjectMetrics = z.infer<typeof ProjectMetrics>;

/** Project names come from the registry, so the agency graph stays anonymous. */
export const AgencyMetrics = z.object({
  projects: z.array(
    z.object({
      projectId: Id,
      name: z.string(),
      order: z.int(),
      closedAt: EpochMs.nullable(),
      clarityBand: ClarityBand.nullable(),
      estimateError: z.number().nullable(),
      questions: Count,
      cardsReopenedPerCR: z.number().nullable(),
      lessonsUsed: Count,
      // (P, approved decision 6) the lessons its current estimates used, for the chart tooltip
      lessons: z.array(z.object({ id: Id, featureKind: FeatureKind, clarityBand: ClarityBand })),
    }),
  ),
  lessons: z.array(LessonView),
});
export type AgencyMetrics = z.infer<typeof AgencyMetrics>;

const Opened = z.array(z.object({ id: Id, kind: WorkItemKind }));
export const PathResponse = z.object({ path: GraphView, ms: z.number().nonnegative() });

// UI token routes

// 1 POST /api/projects
export const CreateProjectBody = z.object({
  clientName: text(80).min(1),
  projectName: text(80).min(1),
  mode: Mode,
});
export const CreateProjectResponse = z.object({ project: ProjectInfo });
// 2 GET /api/projects
export const ListProjectsResponse = z.object({ projects: z.array(ProjectInfo) });
// 3 GET /api/projects/:id (S)
export const GetProjectResponse = z.object({ project: ProjectInfo, seq: Seq });
// 4 POST /api/projects/:id/files (multipart field `files`)
export const UPLOAD_RULES = {
  field: "files",
  maxFiles: 10,
  maxBytes: 10 * 1024 * 1024,
  extensions: [".pdf", ".docx", ".txt", ".md"],
} as const;
export const UploadFilesResponse = z.object({ documents: z.array(DocumentInfo) });
// 5 GET /api/projects/:id/documents (S)
export const DocumentsResponse = z.object({ documents: z.array(DocumentInfo), seq: Seq });
// 6 GET /api/projects/:id/nodes/:nodeId
export const NodeResponse = z.object({
  node: z.looseObject({ label: NodeLabel }),
  links: z.array(
    z.object({
      type: EdgeType,
      direction: z.enum(["out", "in"]),
      otherId: Id,
      otherLabel: NodeLabel,
      otherTitle: z.string(),
    }),
  ),
});
// 7 GET /api/projects/:id/episodes/:episodeId
export const EpisodeResponse = z.object({
  episode: Episode,
  document: z.object({ id: Id, name: z.string() }).nullable(),
  before: z.string(),
  after: z.string(),
});
// 8 GET /api/projects/:id/questions (S)
export const QuestionsResponse = z.object({ questions: z.array(QuestionView), seq: Seq });
// 9 POST /api/questions/:id/answer
export const AnswerBody = z
  .object({ version: Version, accept: z.boolean(), text: text(2000).optional() })
  .refine((a) => a.accept || (a.text !== undefined && a.text.length > 0), {
    message: "text is required when accept is false",
    path: ["text"],
  });
export const AnswerResponse = z.object({
  question: QuestionView,
  assumption: AssumptionView,
  episodeId: Id,
  workItemId: Id,
});
// 10 GET /api/projects/:id/gates (S)
export const GatesResponse = z.object({ gates: z.array(GateView), seq: Seq });
// 11 POST /api/gates/:id/decision
export const GateDecisionBody = z.object({
  version: Version,
  decision: z.enum(["approve", "reject"]),
  reason: text(300).optional(),
});
export const GateDecisionResponse = z.object({ gate: GateView, opened: Opened });
// 12 GET /api/projects/:id/board (S)
export const BoardResponse = z.object({
  columns: z.array(Column),
  lanes: z.array(Lane),
  cards: z.array(CardView),
  items: z.array(ItemView),
  seq: Seq,
});
export type BoardResponse = z.infer<typeof BoardResponse>;
// 13 PATCH /api/tasks/:id
export const PatchTaskBody = z.object({
  version: Version,
  title: text(80).optional(),
  description: text(1200).optional(),
  lane: Lane.optional(),
  order: z.int().optional(),
  column: z.enum(["Backlog", "Ready", "Rework"]).optional(),
  criteria: z
    .array(z.object({ key: CriterionKey, text: text(300), testIds: z.array(z.string()) }))
    .optional(),
  unblock: z.literal(true).optional(),
});
export const PatchTaskResponse = z.object({ task: CardView });
// 14 GET /api/projects/:id/progress (S): ProgressView
// 15 GET /api/projects/:id/progress/:metric
export const ProgressMetric = z.union([
  z.enum(["coverage", "openAssumptions"]),
  z.templateLiteral(["lane:", Lane]),
]);
export const ProgressMetricResponse = z.object({
  nodes: z.array(
    z.object({ label: NodeLabel, id: Id, key: z.string().optional(), title: z.string() }),
  ),
});
export type ProgressMetricResponse = z.infer<typeof ProgressMetricResponse>;
// 16 GET /api/projects/:id/graph: query string values arrive as text
export const GraphQuery = z.object({
  focus: Id.optional(),
  depth: z.coerce.number().int().min(1).max(3).default(2),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
// 16 replies with GraphView. 17 why and 18 impact reply with PathResponse
// 20 GET /api/projects/:id/docs/:doc (S)
export const DocResponse = z.object({
  doc: Doc,
  sections: z.array(
    z.object({
      id: Id,
      order: z.int(),
      title: z.string(),
      body: z.string(),
      stale: z.boolean(),
      renders: z.array(z.object({ label: NodeLabel, id: Id, key: z.string(), text: z.string() })),
    }),
  ),
  designVersion: Count,
  seq: Seq,
});
export type DocResponse = z.infer<typeof DocResponse>;
// 21 POST /api/chat
export const ChatBody = z.object({
  text: z.string().min(1).max(2000),
  docSectionId: Id.optional(),
});
export const ChatResponse = z.object({
  episodeId: Id,
  route: z.enum(["doc_revision", "change_request"]),
  workItemId: Id,
  crId: Id.optional(),
  crKey: CrKey.optional(),
});
// 22 POST /api/projects/:id/change-requests
export const ChangeRequestBody = z.object({ text: z.string().min(1).max(2000) });
export const ChangeRequestResponse = z.object({
  crId: Id,
  crKey: CrKey,
  episodeId: Id,
  workItemId: Id,
});
// 23 POST /api/query (with X-AM-Project): same as read_query
export const QueryBody = ReadQueryInput;
export const QueryResponse = ReadQueryOutput;
// 24 GET /api/projects/:id/metrics (S): ProjectMetrics. 25 GET /api/agency/metrics: AgencyMetrics
// 26 GET /api/projects/:id/features (S)
export const FeaturesResponse = z.object({ features: z.array(FeatureView), seq: Seq });
// 27 GET /api/projects/:id/readiness
export const ReadinessResponse = z.object({
  report: z
    .object({
      id: Id,
      passed: z.boolean(),
      override: z.boolean(),
      checks: z.array(ReadinessCheck),
      createdAt: EpochMs,
    })
    .nullable(),
});
export type ReadinessResponse = z.infer<typeof ReadinessResponse>;
// 29 POST /api/projects/:id/close
export const CloseProjectBody = z.object({
  actuals: z.array(z.object({ featureId: Id, actualHours: z.number().nonnegative() })),
  /** A failed readiness report closes only with override and a reason. */
  override: z.boolean().optional(),
  reason: text(300).optional(),
});
export const CloseProjectResponse = z.object({ project: ProjectInfo, workItemId: Id });
// 31 POST /api/items/:id/retry (with X-AM-Project)
export const RetryItemBody = z.object({});
export const RetryItemResponse = z.object({ item: WorkItem });

// Evidence routes (UI token): what the agents did, for the Home feed, Pipeline and card story.

// GET /api/projects/:id/events: the gateway's replay buffer, oldest first (in memory: a gateway
// restart empties it).
export const EventsResponse = z.object({ events: z.array(Envelope) });
export type EventsResponse = z.infer<typeof EventsResponse>;
// GET /api/projects/:id/commits/:sha/diff: one commit of the project's repo, file by file.
export const CommitDiffResponse = z.object({
  sha: Sha,
  files: z.array(z.object({ path: z.string(), patch: z.string() })),
  truncated: z.boolean(), // the patch was longer than the route sends
});
export type CommitDiffResponse = z.infer<typeof CommitDiffResponse>;
// GET /api/projects/:id/items: every WorkItem of the project, oldest first (the Pipeline screen).
export const ItemsResponse = z.object({ items: z.array(ItemView), seq: Seq });
export type ItemsResponse = z.infer<typeof ItemsResponse>;
// GET /api/projects/:id/items/:itemId/runs: the model calls (Run nodes) of a WorkItem or Task.
export const RunView = z.object({
  step: z.string(),
  agent: AgentId,
  model: z.string(),
  endpoint: z.string().nullable(),
  tokensIn: Count,
  tokensOut: Count,
  ms: Count,
  cost: z.number().nonnegative(),
  createdAt: EpochMs,
});
export const ItemRunsResponse = z.object({ runs: z.array(RunView) });
export type ItemRunsResponse = z.infer<typeof ItemRunsResponse>;
// GET /api/projects/:id/tasks/:taskId/test-runs: the card's test runs, newest first.
export const TestRunView = z.object({
  id: Id,
  sha: Sha,
  passed: z.boolean(),
  durationMs: Count,
  ranAt: EpochMs,
  scope: z.enum(["card", "e2e"]),
  error: z.string().nullable(),
  testCase: z.string(),
  file: z.string(),
});
export const TestRunsResponse = z.object({ runs: z.array(TestRunView) });
export type TestRunsResponse = z.infer<typeof TestRunsResponse>;
// GET /api/projects/:id/cards/:key/files?merged=: the files of a card's code, live from its build
// worktree while it exists, else from its merge commit (`merged`), else from main.
const FileChange = z.enum(["added", "modified", "deleted"]).nullable();
export const CardFilesResponse = z.object({
  source: z.enum(["worktree", "merge", "main", "none"]),
  files: z.array(z.object({ path: z.string(), change: FileChange })),
});
export type CardFilesResponse = z.infer<typeof CardFilesResponse>;
// GET /api/projects/:id/cards/:key/file?path=&merged=: one file's text and the card's diff of it.
export const CardFileResponse = z.object({
  path: z.string(),
  text: z.string(),
  diff: z.string(), // the card's change to the file; empty when it has none
  truncated: z.boolean(),
});
export type CardFileResponse = z.infer<typeof CardFileResponse>;
// GET | POST | DELETE /api/projects/:id/preview: the built app from main, run by the gateway.
export const PreviewView = eventData["preview.changed"];
export type PreviewView = z.infer<typeof PreviewView>;
export const PreviewResponse = z.object({ preview: PreviewView });
export type PreviewResponse = z.infer<typeof PreviewResponse>;

// Agent token route

// 30 POST /api/runs/steps (with X-AM-Project, X-AM-Agent, X-AM-Worker)
export const RunStepBody = z.object({
  itemId: Id,
  step: text(80),
  text: text(200),
  model: z.string().optional(),
  endpoint: Endpoint.optional(),
  tokensIn: Count.optional(),
  tokensOut: Count.optional(),
  ms: Count.optional(),
  cost: z.number().nonnegative().optional(),
  final: z.boolean().optional(),
});
export const RunStepResponse = z.object({});

// No token

// GET /healthz (HTTP 503 when FalkorDB is down)
export const HealthResponse = z.object({
  ok: z.boolean(),
  falkordb: z.enum(["up", "down"]),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

// Git hook route (hook token)

// POST /hooks/commit
export const CommitHookBody = z.object({
  projectId: Id,
  sha: Sha,
  branch: z.string().min(1),
  files: z.array(z.string()),
  message: text(500), // the commit subject line
  author: z.string(),
  committedAt: EpochMs,
});
export const CommitHookResponse = z.object({
  codeChangeId: Id,
  linked: z.boolean(),
  taskId: Id.nullable(),
  workItemId: Id.nullable(),
});
