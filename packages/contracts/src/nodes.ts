// contracts.md section 4. Node schemas parse a node as FalkorDB returns it: a missing
// property reads as null (C10), and JSON-string properties are parsed.
import { z } from "zod";
import {
  Actor,
  Attribute,
  CaseMetrics,
  Count,
  CardKey,
  DESIGN_KEY_PREFIX,
  CriterionKey,
  EntityKey,
  EpochMs,
  FeatureKey,
  Id,
  ReadinessCheck,
  RequirementKey,
  Sha,
  WorkerId,
  jsonString,
  maybe,
  text,
} from "./common";
import {
  AgentId,
  AssumptionStatus,
  ChangeRequestStatus,
  ClarityBand,
  Column,
  ContradictionStatus,
  DefectSeverity,
  DefectStatus,
  Doc,
  DocumentStatus,
  Endpoint,
  EpisodeKind,
  FeatureKind,
  GateKey,
  GateStatus,
  HttpMethod,
  Lane,
  Mode,
  Priority,
  QuestionKind,
  QuestionStatus,
  Stage,
  TaskKind,
  WorkItemKind,
  WorkItemStatus,
} from "./enums";

const Version = z.int().min(1);

/** id, createdBy, createdAt and version: on every node in every graph. */
const Stamped = z.object({ id: Id, createdBy: Actor, createdAt: EpochMs, version: Version });
/** The common five of a client-graph node. */
const BaseNode = Stamped.extend({ projectId: Id });

// Registry graph

export const Client = Stamped.extend({ name: text(80) });
export type Client = z.infer<typeof Client>;

export const Project = Stamped.extend({
  clientId: Id,
  name: text(80),
  mode: Mode,
  stage: Stage,
  closedAt: maybe(EpochMs),
  rejectedWrites: Count,
  rejectedClaims: Count,
  rejectedCompletions: Count,
  rejectedQueries: Count,
});
export type Project = z.infer<typeof Project>;

// Client graph

export const Document = BaseNode.extend({
  name: text(200),
  mime: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "must be 64 hex characters"),
  uploadedAt: EpochMs,
  status: DocumentStatus,
  episodeCount: Count,
  wordCount: Count,
  error: maybe(z.string()),
});
export type Document = z.infer<typeof Document>;

export const Episode = BaseNode.extend({
  kind: EpisodeKind,
  documentId: maybe(Id),
  page: maybe(z.int().min(1)),
  lineStart: maybe(z.int().min(1)),
  lineEnd: maybe(z.int().min(1)),
  text: text(2000),
});
export type Episode = z.infer<typeof Episode>;

export const Entity = BaseNode.extend({
  key: EntityKey,
  name: text(80),
  aliases: z.array(z.string()),
});
export type Entity = z.infer<typeof Entity>;

export const Fact = BaseNode.extend({
  statement: text(300),
  subject: EntityKey,
  attribute: Attribute,
  value: text(200),
  validFrom: EpochMs,
  validTo: maybe(EpochMs),
});
export type Fact = z.infer<typeof Fact>;

export const Contradiction = BaseNode.extend({ summary: text(300), status: ContradictionStatus });
export type Contradiction = z.infer<typeof Contradiction>;

export const Question = BaseNode.extend({
  kind: QuestionKind,
  text: text(200),
  recommended: text(400),
  reasoning: text(600),
  approach: text(600),
  status: QuestionStatus,
});
export type Question = z.infer<typeof Question>;

export const Assumption = BaseNode.extend({ text: text(300), status: AssumptionStatus });
export type Assumption = z.infer<typeof Assumption>;

export const Requirement = BaseNode.extend({
  key: RequirementKey,
  text: text(300),
  priority: Priority,
  validTo: maybe(EpochMs),
  productVersion: Count,
});
export type Requirement = z.infer<typeof Requirement>;

export const Feature = BaseNode.extend({
  key: FeatureKey,
  name: text(80),
  featureKind: FeatureKind,
  validTo: maybe(EpochMs),
  productVersion: Count,
  actualHours: maybe(z.number().nonnegative()),
});
export type Feature = z.infer<typeof Feature>;

export const Estimate = BaseNode.extend({
  hours: z.number().nonnegative(),
  rawHours: z.number().nonnegative(),
  basis: text(200),
  lessonIds: z.array(Id),
  productVersion: Count,
});
export type Estimate = z.infer<typeof Estimate>;

export const AcceptanceCriterion = BaseNode.extend({
  key: CriterionKey,
  text: text(300),
  testIds: z.array(z.string()),
});
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterion>;

export const ChangeRequest = BaseNode.extend({ text: text(2000), status: ChangeRequestStatus });
export type ChangeRequest = z.infer<typeof ChangeRequest>;

const DesignNode = BaseNode.extend({
  key: z.string(),
  name: text(80),
  body: text(1500),
  designVersion: Count,
});
const designNode = (prefix: string) =>
  DesignNode.extend({
    key: z.string().regex(new RegExp(`^${prefix}-\\d{2,}$`), `must look like ${prefix}-01`),
  });

export const Decision = designNode(DESIGN_KEY_PREFIX.Decision);
export type Decision = z.infer<typeof Decision>;
export const Component = designNode(DESIGN_KEY_PREFIX.Component);
export type Component = z.infer<typeof Component>;
export const Screen = designNode(DESIGN_KEY_PREFIX.Screen);
export type Screen = z.infer<typeof Screen>;
export const DataEntity = designNode(DESIGN_KEY_PREFIX.DataEntity);
export type DataEntity = z.infer<typeof DataEntity>;
export const Risk = designNode(DESIGN_KEY_PREFIX.Risk);
export type Risk = z.infer<typeof Risk>;
/** The Endpoint design node. Named apart from the `Endpoint` enum (the model endpoint). */
export const EndpointNode = designNode(DESIGN_KEY_PREFIX.Endpoint).extend({
  method: HttpMethod,
  path: z.string().startsWith("/"),
});
export type EndpointNode = z.infer<typeof EndpointNode>;

export const DocSection = BaseNode.extend({
  doc: Doc,
  order: z.int().min(0),
  title: text(80),
  body: text(1500),
  stale: z.boolean(),
  designVersion: Count,
});
export type DocSection = z.infer<typeof DocSection>;

export const Gate = BaseNode.extend({
  key: GateKey,
  status: GateStatus,
  decidedBy: maybe(Actor),
  decidedAt: maybe(EpochMs),
  reason: maybe(text(300)),
  override: maybe(z.boolean()), // G5 only
});
export type Gate = z.infer<typeof Gate>;

/** The WorkItem node. It is also the shared WorkItem type of contracts.md section 5. */
export const WorkItem = BaseNode.extend({
  kind: WorkItemKind,
  status: WorkItemStatus,
  subjectId: maybe(Id),
  note: maybe(text(2000)),
  handoff: maybe(text(2000)),
  outputIds: z.array(Id),
  leaseOwner: maybe(WorkerId),
  leaseUntil: maybe(EpochMs),
  attempts: Count,
  doneAt: maybe(EpochMs),
});
export type WorkItem = z.infer<typeof WorkItem>;

export const Task = BaseNode.extend({
  key: CardKey,
  title: text(80),
  description: text(1200),
  lane: Lane,
  column: Column,
  order: z.int(),
  kind: TaskKind,
  note: maybe(text(500)),
  mergedSha: maybe(Sha),
  leaseOwner: maybe(WorkerId),
  leaseUntil: maybe(EpochMs),
  attempts: Count,
});
export type Task = z.infer<typeof Task>;

export const TestCase = BaseNode.extend({ file: z.string(), title: text(200) });
export type TestCase = z.infer<typeof TestCase>;

export const TestRun = BaseNode.extend({
  sha: Sha,
  passed: z.boolean(),
  durationMs: Count,
  ranAt: EpochMs,
  scope: z.enum(["card", "e2e"]),
  error: maybe(text(500)),
});
export type TestRun = z.infer<typeof TestRun>;

export const CodeChange = BaseNode.extend({
  sha: Sha,
  branch: z.string(),
  files: z.array(z.string()),
  message: text(500),
  author: z.string(),
  committedAt: EpochMs,
  linked: z.boolean(),
});
export type CodeChange = z.infer<typeof CodeChange>;

export const Defect = BaseNode.extend({
  title: text(120),
  severity: DefectSeverity,
  status: DefectStatus,
});
export type Defect = z.infer<typeof Defect>;

export const Deployment = BaseNode.extend({
  environment: text(40),
  deployedAt: EpochMs,
  deployedBy: Actor,
});
export type Deployment = z.infer<typeof Deployment>;

export const Run = BaseNode.extend({
  agent: AgentId,
  step: text(80),
  model: z.string(),
  tokensIn: Count,
  tokensOut: Count,
  ms: Count,
  cost: z.number().nonnegative(),
  itemId: Id,
  endpoint: Endpoint,
});
export type Run = z.infer<typeof Run>;

export const ReadinessReport = BaseNode.extend({
  passed: z.boolean(),
  checks: jsonString(z.array(ReadinessCheck)),
  override: z.boolean(),
});
export type ReadinessReport = z.infer<typeof ReadinessReport>;

// Agency graph

export const EstimateRecord = BaseNode.extend({
  featureKind: FeatureKind,
  clarityBand: ClarityBand,
  estimate: z.number().nonnegative(),
  raw: z.number().nonnegative(),
  actual: z.number().nonnegative(),
});
export type EstimateRecord = z.infer<typeof EstimateRecord>;

/** No projectId: a Lesson is shared by many projects. */
export const Lesson = Stamped.extend({
  featureKind: FeatureKind,
  clarityBand: ClarityBand,
  ratio: z.number().nonnegative(),
  n: Count,
  text: text(300),
  projectIds: z.array(Id),
});
export type Lesson = z.infer<typeof Lesson>;

export const CaseStudy = BaseNode.extend({
  metrics: jsonString(CaseMetrics),
  lessonsLearned: text(1500),
});
export type CaseStudy = z.infer<typeof CaseStudy>;

/** Every node label, keyed to its schema. */
export const nodeSchemas = {
  Client,
  Project,
  Document,
  Episode,
  Entity,
  Fact,
  Contradiction,
  Question,
  Assumption,
  Requirement,
  Feature,
  Estimate,
  AcceptanceCriterion,
  ChangeRequest,
  Decision,
  Component,
  Screen,
  DataEntity,
  Endpoint: EndpointNode,
  Risk,
  DocSection,
  Gate,
  WorkItem,
  Task,
  TestCase,
  TestRun,
  CodeChange,
  Defect,
  Deployment,
  Run,
  ReadinessReport,
  EstimateRecord,
  Lesson,
  CaseStudy,
} as const;

export const NodeLabel = z.enum(
  Object.keys(nodeSchemas) as [keyof typeof nodeSchemas, ...(keyof typeof nodeSchemas)[]],
);
export type NodeLabel = z.infer<typeof NodeLabel>;
