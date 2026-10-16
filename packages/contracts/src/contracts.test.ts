import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  AgencyMetrics,
  AnswerBody,
  BoardResponse,
  CaseStudy,
  ClaimItemOutput,
  CommitHookBody,
  CommitHookResponse,
  CreateProjectBody,
  Document,
  Envelope,
  EventType,
  GatesResponse,
  GateDecisionBody,
  GraphQuery,
  HealthResponse,
  Lesson,
  NodeLabel,
  PatchTaskBody,
  PathResponse,
  ProgressMetric,
  Project,
  ReadinessReport,
  Rejection,
  RunStepBody,
  ServerMessage,
  SubscribeMessage,
  ToolName,
  WorkItem,
  WorkerId,
  WriteCardsInput,
  WriteQuestionInput,
  AnswerResponse,
  BugReportBody,
  BugReportResponse,
  ChangeRequestBody,
  ChangeRequestResponse,
  ChatBody,
  ChatResponse,
  CloseProjectBody,
  CloseProjectResponse,
  CreateProjectResponse,
  DocResponse,
  DocumentsResponse,
  EpisodeResponse,
  ErrorBody,
  FeaturesResponse,
  GateDecisionResponse,
  GetProjectResponse,
  ListProjectsResponse,
  NodeResponse,
  PatchTaskResponse,
  ProgressMetricResponse,
  ProgressView,
  ProjectMetrics,
  QueryBody,
  QueryResponse,
  QuestionsResponse,
  ReadinessResponse,
  RetryItemBody,
  RetryItemResponse,
  RunStepResponse,
  UploadFilesResponse,
  clarityBand,
  httpStatus,
  nodeSchemas,
  rejectionCounter,
  tools,
} from "./index";

const ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const ID2 = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const SHA = "a".repeat(40);
const NOW = 1_760_000_000_000;
const base = { id: ID, projectId: ID, createdBy: "intake", createdAt: NOW, version: 1 };

const workItem = {
  ...base,
  kind: "intake",
  status: "claimed",
  subjectId: ID2,
  note: null,
  handoff: null,
  outputIds: [],
  leaseOwner: "intake-1",
  leaseUntil: NOW + 600_000,
  attempts: 0,
  doneAt: null,
};
const projectInfo = {
  id: ID,
  clientId: ID2,
  clientName: "Synthetic Clinic",
  name: "Booking",
  mode: "demo",
  stage: "intake",
  productVersion: 0,
  designVersion: 0,
  clarity: null,
  closedAt: null,
  createdAt: NOW,
};
const check = { name: "cards_done", passed: true, detail: "All cards are Done", nodeIds: [] };
const metrics = {
  estimateError: 0.2,
  questions: 7,
  contradictions: 5,
  changeRequests: 1,
  cardsReopened: 2,
  defects: 1,
  cards: 8,
  firstPassCards: 6,
  clarityBand: "medium",
};
const graphView = {
  nodes: [
    { id: ID, label: "Fact", title: "Open Monday to Saturday", group: "knowledge", state: null },
  ],
  links: [{ source: ID, target: ID2, type: "SOURCED_FROM", label: null }],
};
const run = {
  step: "think",
  model: "thin",
  endpoint: "primary",
  tokensIn: 10,
  tokensOut: 5,
  ms: 300,
  cost: 0.001,
};
const card = {
  key: "CARD-01",
  title: "Booking form",
  description: "Patients book a slot",
  lane: "Frontend",
  order: 1,
  requirementKey: "REQ-01",
  designKeys: ["SCR-01"],
  dependsOn: [],
  criteria: [{ key: "AC-01-1", text: "A slot can be booked", testIds: ["book-submit"] }],
};
const cardView = {
  id: ID,
  key: "CARD-01",
  title: "Booking form",
  description: "Patients book a slot",
  lane: "Frontend",
  column: "Ready",
  order: 1,
  kind: "build",
  version: 2,
  attempts: 0,
  blocked: false,
  note: null,
  leaseHolder: null,
  leaseUntil: null,
  testStatus: "none",
  commits: [],
  rework: false,
  crIds: [],
  crKeys: [],
  requirementKey: "REQ-01",
  dependsOn: [],
  criteria: [
    {
      id: ID2,
      key: "AC-01-1",
      text: "A slot can be booked",
      testIds: ["book-submit"],
      testCaseCount: 1,
    },
  ],
  gate: null,
  mergedSha: null,
};
const gateView = {
  id: ID,
  key: "G1",
  status: "waiting",
  version: 1,
  decidedBy: null,
  decidedAt: null,
  reason: null,
  canDecide: true,
  blockedBy: [],
  task: null,
};
const documentInfo = {
  id: ID,
  name: "notes.md",
  mime: "text/markdown",
  status: "processed",
  episodeCount: 3,
  wordCount: 120,
  error: null,
  uploadedAt: NOW,
};
const questionView = {
  id: ID,
  kind: "contradiction",
  text: "Is the clinic open on Saturday?",
  recommended: "Open Saturday morning",
  reasoning: "Two notes disagree",
  approach: "Ask the owner",
  status: "open",
  version: 1,
  assumption: { id: ID2, text: "Open Saturday morning", status: "open" },
  contradiction: { id: ID, summary: "Saturday opening differs", status: "open" },
  sources: [
    {
      episodeId: ID,
      factId: ID2,
      factStatement: "Open Monday to Saturday",
      documentName: "notes.md",
      page: 1,
      lineStart: 1,
      lineEnd: 2,
      text: "Open Monday to Saturday.",
    },
  ],
  answer: null,
};
const featureView = {
  id: ID,
  key: "FEAT-01",
  name: "Booking",
  featureKind: "form",
  productVersion: 1,
  requirementKeys: ["REQ-01"],
  actualHours: null,
  estimate: {
    hours: 7.5,
    rawHours: 6,
    basis: "One form",
    lessons: [
      {
        id: ID2,
        featureKind: "form",
        clarityBand: "medium",
        ratio: 1.25,
        n: 2,
        text: "Forms run long",
        projectIds: [ID],
      },
    ],
  },
};
const rejection = {
  code: "GUARD_REJECTED",
  guard: "version",
  reason: "The card changed since you read it.",
  details: { reasonCode: "VERSION_OLD", current: 3, sent: 2 },
};

/** One input and one output per MCP tool. */
const toolFixtures: Record<ToolName, { input: unknown; output: unknown }> = {
  claim_item: { input: { kinds: ["intake"] }, output: { item: workItem } },
  heartbeat: { input: { itemId: ID }, output: { leaseUntil: NOW } },
  complete_item: {
    input: { itemId: ID, outcome: "done", runs: [run], result: { mergedSha: SHA } },
    output: {
      item: { id: ID, status: "done", attempts: 0 },
      opened: [{ id: ID2, kind: "discovery" }],
    },
  },
  recall_context: {
    input: { itemId: ID },
    output: {
      item: workItem,
      project: projectInfo,
      context: {
        handoffs: [{ kind: "intake", agent: "intake", summary: "Read 3 files", doneAt: NOW }],
        episodes: [
          {
            id: ID,
            kind: "file_chunk",
            documentName: "notes.md",
            page: 1,
            lineStart: 1,
            lineEnd: 4,
            text: "Open Monday to Saturday.",
          },
        ],
        facts: [
          {
            id: ID2,
            statement: "The clinic opens Monday to Saturday",
            subject: "clinic",
            attribute: "opening_days",
            value: "Monday to Saturday",
            episodeIds: [ID],
            validTo: null,
            replacedBy: null,
          },
        ],
      },
      chars: 512,
    },
  },
  write_handoff: {
    input: { itemId: ID, summary: "Launch checks", outputIds: [], report: { checks: [check] } },
    output: { itemId: ID, reportId: ID2 },
  },
  write_fact: {
    input: {
      itemId: ID,
      facts: [
        {
          statement: "The clinic opens Monday to Saturday",
          subject: "clinic",
          attribute: "opening_days",
          value: "Monday to Saturday",
          entity: { key: "clinic", name: "Clinic", aliases: ["the practice"] },
          episodeIds: [ID],
        },
      ],
    },
    output: { factIds: [ID2], entityIds: [ID], superseded: [] },
  },
  write_question: {
    input: {
      itemId: ID,
      questions: [
        {
          kind: "contradiction",
          text: "Is the clinic open on Saturday?",
          recommended: "Open Saturday morning",
          reasoning: "Two notes disagree",
          approach: "Ask the owner",
          assumption: "Open Saturday morning",
          factIds: [ID, ID2],
          contradiction: { summary: "Saturday opening differs between notes" },
        },
      ],
    },
    output: { questionIds: [ID], contradictionIds: [ID2], assumptionIds: [ID] },
  },
  write_product: {
    input: {
      itemId: ID,
      baseVersion: 0,
      requirements: [
        { key: "REQ-01", text: "Patients book online", priority: "must", factIds: [ID] },
      ],
      features: [
        {
          key: "FEAT-01",
          name: "Booking",
          featureKind: "form",
          requirementKeys: ["REQ-01"],
          estimate: { rawHours: 6, hours: 7.5, basis: "One form", lessonIds: [] },
        },
      ],
    },
    output: {
      productVersion: 1,
      requirementIds: [ID],
      featureIds: [ID],
      estimateIds: [ID],
      ended: [],
    },
  },
  record_change_request: {
    input: {
      itemId: ID,
      crId: ID2,
      changes: [{ oldFactId: ID, statement: "Closed on Saturday", value: "Monday to Friday" }],
    },
    output: {
      newFactIds: [ID],
      flagged: { taskIds: [ID], docSectionIds: [] },
      crStatus: "applied",
    },
  },
  find_impact: {
    input: { factId: ID },
    output: { nodes: [{ type: "Requirement", id: ID, label: "REQ-01" }] },
  },
  write_design: {
    input: {
      itemId: ID,
      baseVersion: 0,
      nodes: [
        {
          label: "Endpoint",
          key: "EP-01",
          name: "Create booking",
          body: "Stores a booking",
          method: "POST",
          path: "/api/bookings",
          requirementKeys: ["REQ-01"],
        },
      ],
      sections: [{ doc: "tdd", order: 1, title: "API", body: "## API", renders: ["EP-01"] }],
    },
    output: { designVersion: 1, nodeIds: [ID], sectionIds: [ID2] },
  },
  write_cards: {
    input: { itemId: ID, mode: "create", cards: [card] },
    output: { taskIds: [ID], criterionIds: [ID2] },
  },
  write_tests: {
    input: {
      itemId: ID,
      taskId: ID2,
      sha: SHA,
      cases: [{ criterionKey: "AC-01-1", file: "tests/card-01.spec.ts", title: "books a slot" }],
    },
    output: { testCaseIds: [ID], taskColumn: "Ready" },
  },
  submit_test_run: {
    input: {
      itemId: ID,
      sha: SHA,
      taskId: ID2,
      results: [{ testCaseId: ID, passed: true, durationMs: 1200 }],
    },
    output: { testRunIds: [ID], allPassed: true, taskColumn: "Testing" },
  },
  claim_task: {
    input: {},
    output: {
      task: {
        id: ID,
        key: "CARD-01",
        title: "Booking form",
        version: 3,
        column: "In progress",
        lane: "Frontend",
        kind: "build",
        attempts: 0,
        branch: "card/CARD-01",
      },
    },
  },
  get_task_context: {
    input: { taskId: ID },
    output: {
      task: {
        id: ID,
        key: "CARD-01",
        title: "Booking form",
        description: "Patients book a slot",
        lane: "Frontend",
        kind: "build",
        version: 3,
        branch: "card/CARD-01",
        note: null,
      },
      requirement: {
        key: "REQ-01",
        text: "Patients book online",
        facts: [{ id: ID, statement: "Booking is online" }],
      },
      criteria: [{ key: "AC-01-1", text: "A slot can be booked", testIds: ["book-submit"] }],
      design: [{ label: "Screen", key: "SCR-01", name: "Booking", body: "Form" }],
      testCases: [
        { file: "tests/card-01.spec.ts", title: "books a slot", criterionKey: "AC-01-1" },
      ],
      codeChanges: [],
      episodes: [
        { documentName: "notes.md", page: 1, lineStart: 1, lineEnd: 2, excerpt: "Book online" },
      ],
      defect: null,
      conventions: { testIdRule: "kebab-case data-testid", stack: "Node 22, node:sqlite" },
      truncated: false,
      chars: 900,
    },
  },
  complete_task: {
    input: { taskId: ID, version: 3 },
    output: { task: { id: ID, key: "CARD-01", column: "Done", version: 4 } },
  },
  report_defect: {
    input: {
      itemId: ID,
      title: "Booking fails on Saturday",
      severity: "high",
      codeChangeId: ID2,
      reportEpisodeId: ID,
      reasoning: "The commit changed the day check",
    },
    output: { defectId: ID },
  },
  propose_fix: {
    input: { itemId: ID, defectId: ID2, card },
    output: { taskId: ID, gateId: ID2 },
  },
  write_case_study: {
    input: {
      itemId: ID,
      caseStudy: { metrics, lessonsLearned: "Forms took longer than estimated." },
      records: [{ featureKind: "form", clarityBand: "medium", estimate: 7.5, raw: 6, actual: 9 }],
      lessons: [
        { featureKind: "form", clarityBand: "medium", text: "Forms run 1.5x the raw estimate." },
      ],
    },
    output: { caseStudyId: ID, recordIds: [ID2], lessonIds: [ID] },
  },
  read_query: {
    input: {
      graph: "client",
      cypher: "x",
      params: { key: "REQ-01", n: 1, flag: true, none: null },
    },
    output: { columns: ["n"], rows: [[1]], ms: 4, truncated: false },
  },
};

/** One node per label, as the graph returns it (missing properties are absent). */
const design = { ...base, key: "DEC-01", name: "Use SQLite", body: "One file", designVersion: 1 };
const nodeFixtures: Record<NodeLabel, unknown> = {
  Client: { id: ID, name: "Synthetic Clinic", createdBy: "human:ana", createdAt: NOW, version: 1 },
  Project: {
    id: ID,
    clientId: ID2,
    name: "Booking",
    mode: "demo",
    stage: "intake",
    rejectedWrites: 0,
    rejectedClaims: 0,
    rejectedCompletions: 0,
    rejectedQueries: 0,
    createdBy: "human:ana",
    createdAt: NOW,
    version: 1,
  },
  Document: {
    ...base,
    name: "notes.md",
    mime: "text/markdown",
    sha256: "b".repeat(64),
    uploadedAt: NOW,
    status: "processed",
    episodeCount: 3,
    wordCount: 120,
  },
  Episode: {
    ...base,
    kind: "file_chunk",
    documentId: ID2,
    page: 1,
    lineStart: 1,
    lineEnd: 3,
    text: "Open Monday.",
  },
  Entity: { ...base, key: "clinic", name: "Clinic", aliases: [] },
  Fact: {
    ...base,
    statement: "The clinic opens Monday",
    subject: "clinic",
    attribute: "opening_days",
    value: "Monday",
    validFrom: NOW,
  },
  Contradiction: { ...base, summary: "Opening days differ", status: "open" },
  Question: {
    ...base,
    kind: "open",
    text: "Who confirms bookings?",
    recommended: "Reception",
    reasoning: "Not stated",
    approach: "Ask",
    status: "open",
  },
  Assumption: { ...base, text: "Reception confirms", status: "open" },
  Requirement: { ...base, key: "REQ-01", text: "Book online", priority: "must", productVersion: 1 },
  Feature: { ...base, key: "FEAT-01", name: "Booking", featureKind: "form", productVersion: 1 },
  Estimate: {
    ...base,
    hours: 7.5,
    rawHours: 6,
    basis: "One form",
    lessonIds: [],
    productVersion: 1,
  },
  AcceptanceCriterion: {
    ...base,
    key: "AC-01-1",
    text: "A slot can be booked",
    testIds: ["book-submit"],
  },
  ChangeRequest: { ...base, key: "CR-1", text: "Closed on Saturday", status: "open" },
  Decision: design,
  Component: { ...design, key: "CMP-01" },
  Screen: { ...design, key: "SCR-01" },
  DataEntity: { ...design, key: "ENT-01" },
  Risk: { ...design, key: "RSK-01" },
  Endpoint: { ...design, key: "EP-01", method: "GET", path: "/api/slots" },
  DocSection: {
    ...base,
    doc: "prd",
    order: 1,
    title: "Goals",
    body: "Book online",
    stale: false,
    designVersion: 1,
  },
  Gate: { ...base, key: "G1", status: "waiting" },
  WorkItem: workItem,
  Task: {
    ...base,
    key: "CARD-01",
    title: "Booking form",
    description: "Book a slot",
    lane: "Frontend",
    column: "Backlog",
    order: 1,
    kind: "build",
    attempts: 0,
  },
  TestCase: { ...base, file: "tests/card-01.spec.ts", title: "books a slot" },
  TestRun: { ...base, sha: SHA, passed: true, durationMs: 900, ranAt: NOW, scope: "card" },
  CodeChange: {
    ...base,
    sha: SHA,
    branch: "card/CARD-01",
    files: ["src/app.ts"],
    message: "Add booking form",
    author: "opencode",
    committedAt: NOW,
    linked: true,
  },
  Defect: { ...base, title: "Saturday bug", severity: "high", status: "open" },
  Deployment: { ...base, environment: "staging", deployedAt: NOW, deployedBy: "human:ana" },
  Run: { ...base, ...run, agent: "intake", itemId: ID2 },
  ReadinessReport: { ...base, passed: true, checks: JSON.stringify([check]), override: false },
  EstimateRecord: {
    ...base,
    featureKind: "form",
    clarityBand: "medium",
    estimate: 7.5,
    raw: 6,
    actual: 9,
  },
  Lesson: {
    id: ID,
    featureKind: "form",
    clarityBand: "medium",
    ratio: 1.5,
    n: 1,
    text: "Forms run long",
    projectIds: [ID2],
    createdBy: "curator",
    createdAt: NOW,
    version: 1,
  },
  CaseStudy: { ...base, metrics: JSON.stringify(metrics), lessonsLearned: "Forms run long" },
};

/** One data payload per WebSocket event type. */
const eventFixtures: Record<EventType, unknown> = {
  "node.written": {
    label: "Fact",
    id: ID,
    version: 1,
    summary: "Fact: opening days",
    ids: [ID, ID2],
  },
  "node.ended": { factId: ID, validTo: NOW, replacedBy: ID2 },
  "task.moved": { taskId: ID, key: "CARD-01", from: null, to: "Backlog", version: 1 },
  "task.edited": { taskId: ID, fields: ["title"], version: 2, actor: "human:ana" },
  "lease.changed": { itemId: ID, owner: "build-1", until: NOW, reason: "claim" },
  "gate.changed": {
    gateId: ID,
    gateKey: "G1",
    status: "approved",
    decidedBy: "persona:" + ID,
    reason: null,
  },
  "doc.stale": { docSectionId: ID, crId: ID2 },
  "run.step": {
    itemId: ID,
    agent: "build",
    step: "edit",
    text: "Edited 2 files",
    model: null,
    tokens: 0,
    ms: 10,
  },
  "write.rejected": {
    tool: "PATCH /api/tasks/:id",
    guard: "version",
    reasonCode: "VERSION_OLD",
    reason: "Old version",
    agent: "human:ana",
  },
  "metrics.updated": { metric: "rejectedWrites", value: 3 },
};

/** REST bodies and replies: [name, schema, fixture]. */
const restFixtures: [string, z.ZodType, unknown][] = [
  [
    "CreateProjectBody",
    CreateProjectBody,
    { clientName: "Synthetic Clinic", projectName: "Booking", mode: "demo" },
  ],
  ["AnswerBody", AnswerBody, { version: 1, accept: false, text: "Closed on Saturday" }],
  [
    "GateDecisionBody",
    GateDecisionBody,
    { version: 1, decision: "reject", reason: "Too many features" },
  ],
  ["PatchTaskBody", PatchTaskBody, { version: 2, column: "Rework", unblock: true }],
  ["GraphQuery", GraphQuery, { depth: "3", limit: "100" }],
  ["ProgressMetric", ProgressMetric, "lane:Frontend"],
  [
    "BoardResponse",
    BoardResponse,
    {
      columns: ["Backlog", "Ready"],
      lanes: ["Frontend"],
      cards: [cardView],
      items: [
        {
          id: ID,
          kind: "intake",
          agent: "intake",
          status: "open",
          leaseOwner: null,
          leaseUntil: null,
          attempts: 0,
          lastStep: null,
          doneAt: null,
        },
      ],
      seq: 12,
    },
  ],
  [
    "AgencyMetrics",
    AgencyMetrics,
    {
      projects: [
        {
          projectId: ID,
          name: "Booking",
          order: 1,
          closedAt: null,
          clarityBand: null,
          estimateError: null,
          questions: 4,
          cardsReopenedPerCR: null,
          lessonsUsed: 0,
        },
      ],
      lessons: [{ id: ID, featureKind: "form", clarityBand: "medium", ratio: 1.5, n: 1 }],
    },
  ],
  [
    "RunStepBody",
    RunStepBody,
    { itemId: ID, step: "edit", text: "Edited a file", final: true, tokensIn: 3 },
  ],
  ["HealthResponse", HealthResponse, { ok: true, falkordb: "up", version: "0.0.0" }],
  [
    "CommitHookBody",
    CommitHookBody,
    {
      projectId: ID,
      sha: SHA,
      branch: "card/CARD-01",
      files: ["src/app.ts"],
      message: "Add form",
      author: "opencode",
      committedAt: NOW,
    },
  ],
  ["GatesResponse", GatesResponse, { gates: [gateView], seq: 3 }],
  ["PathResponse", PathResponse, { path: graphView, ms: 12 }],
  [
    "CommitHookResponse",
    CommitHookResponse,
    { codeChangeId: ID, linked: true, taskId: ID2, workItemId: null },
  ],
  ["CreateProjectResponse", CreateProjectResponse, { project: projectInfo }],
  ["ListProjectsResponse", ListProjectsResponse, { projects: [projectInfo] }],
  ["GetProjectResponse", GetProjectResponse, { project: projectInfo, seq: 0 }],
  ["UploadFilesResponse", UploadFilesResponse, { documents: [documentInfo] }],
  ["DocumentsResponse", DocumentsResponse, { documents: [documentInfo], seq: 4 }],
  [
    "NodeResponse",
    NodeResponse,
    {
      node: { label: "Fact", ...(nodeFixtures.Fact as object) },
      links: [
        {
          type: "SOURCED_FROM",
          direction: "out",
          otherId: ID2,
          otherLabel: "Episode",
          otherTitle: "notes.md p1 l1-3",
        },
      ],
    },
  ],
  [
    "EpisodeResponse",
    EpisodeResponse,
    {
      episode: nodeFixtures.Episode,
      document: { id: ID2, name: "notes.md" },
      before: "",
      after: "Closed Sunday.",
    },
  ],
  ["QuestionsResponse", QuestionsResponse, { questions: [questionView], seq: 5 }],
  [
    "AnswerResponse",
    AnswerResponse,
    {
      question: questionView,
      assumption: questionView.assumption,
      episodeId: ID,
      workItemId: ID2,
    },
  ],
  [
    "GateDecisionResponse",
    GateDecisionResponse,
    { gate: gateView, opened: [{ id: ID, kind: "proposal" }] },
  ],
  ["PatchTaskResponse", PatchTaskResponse, { task: cardView }],
  [
    "ProgressView",
    ProgressView,
    {
      stage: "build",
      gates: [{ key: "G1", status: "approved" }],
      lanes: [{ lane: "Frontend", done: 1, total: 3 }],
      coverage: { covered: 1, total: 4 },
      openAssumptions: 0,
      openDefects: 0,
      seq: 7,
    },
  ],
  [
    "ProgressMetricResponse",
    ProgressMetricResponse,
    { nodes: [{ label: "Requirement", id: ID, key: "REQ-01", title: "Book online" }] },
  ],
  [
    "DocResponse",
    DocResponse,
    {
      doc: "prd",
      sections: [
        {
          id: ID,
          order: 1,
          title: "Goals",
          body: "Book online",
          stale: false,
          renders: [{ label: "Requirement", id: ID2, key: "REQ-01", text: "Book online" }],
        },
      ],
      designVersion: 1,
      seq: 8,
    },
  ],
  ["ChatBody", ChatBody, { text: "Rename the goals section", docSectionId: ID }],
  [
    "ChatResponse",
    ChatResponse,
    { episodeId: ID, route: "change_request", workItemId: ID2, crId: ID, crKey: "CR-1" },
  ],
  ["ChangeRequestBody", ChangeRequestBody, { text: "Closed on Saturday" }],
  [
    "ChangeRequestResponse",
    ChangeRequestResponse,
    { crId: ID, crKey: "CR-1", episodeId: ID2, workItemId: ID },
  ],
  ["QueryBody", QueryBody, toolFixtures.read_query.input],
  ["QueryResponse", QueryResponse, toolFixtures.read_query.output],
  [
    "ProjectMetrics",
    ProjectMetrics,
    {
      estimateError: null,
      questions: 7,
      contradictions: 5,
      changeRequests: 1,
      cardsReopened: 2,
      cardsReopenedPerCR: 2,
      rejected: { writes: 3, claims: 1, completions: 1, queries: 0 },
      coverage: { covered: 2, total: 4 },
      tokensIn: 1000,
      tokensOut: 400,
      cost: 0.12,
      backtraceMs: null,
      seq: 9,
    },
  ],
  ["FeaturesResponse", FeaturesResponse, { features: [featureView], seq: 10 }],
  [
    "ReadinessResponse",
    ReadinessResponse,
    { report: { id: ID, passed: true, override: false, checks: [check], createdAt: NOW } },
  ],
  ["BugReportBody", BugReportBody, { text: "Saturday booking fails" }],
  ["BugReportResponse", BugReportResponse, { episodeId: ID, workItemId: ID2 }],
  ["CloseProjectBody", CloseProjectBody, { actuals: [{ featureId: ID, actualHours: 9 }] }],
  ["CloseProjectResponse", CloseProjectResponse, { project: projectInfo, workItemId: ID }],
  ["RetryItemBody", RetryItemBody, {}],
  ["RetryItemResponse", RetryItemResponse, { item: { ...workItem, status: "open", attempts: 0 } }],
  ["RunStepResponse", RunStepResponse, {}],
  ["ErrorBody", ErrorBody, { error: rejection }],
];

describe("contracts fixtures", () => {
  it("define all 21 MCP tools", () => {
    expect(ToolName.options).toHaveLength(21);
    expect(Object.keys(tools).sort()).toEqual([...ToolName.options].sort());
  });

  it.each(ToolName.options)("%s input and output pass their schemas", (name) => {
    const fixture = toolFixtures[name];
    expect(tools[name].input.parse(fixture.input)).toBeTruthy();
    expect(tools[name].output.parse(fixture.output)).toBeTruthy();
  });

  it.each(NodeLabel.options)("%s node passes its schema", (label) => {
    expect(nodeSchemas[label].parse(nodeFixtures[label])).toBeTruthy();
  });

  it.each(EventType.options)("%s event passes the envelope schema", (type) => {
    const event = { projectId: ID, seq: 1, type, at: NOW, data: eventFixtures[type] };
    expect(Envelope.parse(event)).toMatchObject({ type });
    expect(ServerMessage.parse({ type: "event", event })).toBeTruthy();
  });

  it.each(restFixtures)("%s passes its schema", (_name, schema, fixture) => {
    expect(schema.parse(fixture)).toBeDefined();
  });

  it("parses the WebSocket control messages", () => {
    expect(SubscribeMessage.parse({ type: "subscribe", projectId: ID, since: 4 })).toBeTruthy();
    expect(ServerMessage.parse({ type: "reset", projectId: ID, seq: 9 })).toBeTruthy();
    expect(ServerMessage.parse({ type: "error", error: rejection })).toBeTruthy();
  });

  it("covers the views used by snapshots", () => {
    expect(ClaimItemOutput.parse({ item: null })).toEqual({ item: null });
    expect(tools.write_handoff.output.parse({ itemId: ID, reportId: null })).toBeTruthy();
    expect(Rejection.parse(rejection)).toBeTruthy();
  });
});

describe("contract rules", () => {
  it("rejects an id that is not a ULID", () => {
    expect(tools.heartbeat.input.safeParse({ itemId: "not-a-ulid" }).success).toBe(false);
    expect(tools.heartbeat.input.safeParse({ itemId: ID.toLowerCase() }).success).toBe(false);
  });

  it("rejects text over its limit instead of cutting it", () => {
    const long = { ...(nodeFixtures.Fact as object), statement: "x".repeat(301) };
    expect(nodeSchemas.Fact.safeParse(long).success).toBe(false);
  });

  it("reads a missing node property as null (C10)", () => {
    const fact = nodeSchemas.Fact.parse(nodeFixtures.Fact);
    expect(fact).toMatchObject({ validTo: null });
    expect(WorkItem.parse({ ...workItem, subjectId: undefined }).subjectId).toBeNull();
    expect(Project.parse(nodeFixtures.Project).closedAt).toBeNull();
  });

  it("parses JSON-string properties into objects (C10)", () => {
    expect(ReadinessReport.parse(nodeFixtures.ReadinessReport).checks).toEqual([check]);
    expect(CaseStudy.parse(nodeFixtures.CaseStudy).metrics).toEqual(metrics);
    const bad = { ...(nodeFixtures.CaseStudy as object), metrics: "{not json" };
    expect(CaseStudy.safeParse(bad).success).toBe(false);
  });

  it("keeps projectId off a Lesson and reads a missing Document error as null", () => {
    expect(Lesson.parse(nodeFixtures.Lesson)).not.toHaveProperty("projectId");
    expect(Document.parse(nodeFixtures.Document).error).toBeNull();
  });

  it("checks question rules", () => {
    const q = (toolFixtures.write_question.input as { questions: Record<string, unknown>[] })
      .questions[0]!;
    const parse = (over: Record<string, unknown>) =>
      WriteQuestionInput.safeParse({ itemId: ID, questions: [{ ...q, ...over }] }).success;
    expect(parse({})).toBe(true);
    expect(parse({ text: "Is it open" })).toBe(false); // must end with "?"
    expect(parse({ factIds: [ID] })).toBe(false); // a contradiction needs two facts
    expect(parse({ contradiction: undefined })).toBe(false); // and a summary
    expect(parse({ kind: "open", factIds: [ID], contradiction: undefined })).toBe(true);
  });

  it("needs a card version in update mode", () => {
    expect(WriteCardsInput.safeParse({ itemId: ID, mode: "update", cards: [card] }).success).toBe(
      false,
    );
    expect(
      WriteCardsInput.safeParse({ itemId: ID, mode: "update", cards: [{ ...card, version: 2 }] })
        .success,
    ).toBe(true);
  });

  it("needs method and path on an Endpoint design node only", () => {
    const input = toolFixtures.write_design.input as { nodes: Record<string, unknown>[] };
    const node = input.nodes[0]!;
    const parse = (n: Record<string, unknown>) =>
      tools.write_design.input.safeParse({ ...input, nodes: [n] }).success;
    expect(parse(node)).toBe(true);
    expect(parse({ ...node, method: undefined })).toBe(false);
    expect(parse({ ...node, label: "Screen", key: "SCR-01" })).toBe(false);
    expect(
      parse({ ...node, label: "Screen", key: "EP-01", method: undefined, path: undefined }),
    ).toBe(false);
  });

  it("numbers document sections from 0, as the Architect's outline does", () => {
    const input = toolFixtures.write_design.input as { sections: Record<string, unknown>[] };
    const parse = (order: number) =>
      tools.write_design.input.safeParse({ ...input, sections: [{ ...input.sections[0], order }] })
        .success;
    expect(parse(0)).toBe(true);
    expect(parse(-1)).toBe(false);
  });

  it("needs answer text when the recommendation is not accepted", () => {
    expect(AnswerBody.safeParse({ version: 1, accept: false }).success).toBe(false);
    expect(AnswerBody.safeParse({ version: 1, accept: true }).success).toBe(true);
  });

  it("checks actor and worker formats", () => {
    // (P, task 5.5) the simulator creates projects before it has a project id
    expect(
      tools.claim_item.output.safeParse({ item: { ...workItem, createdBy: "persona:sim" } })
        .success,
    ).toBe(true);
    expect(
      tools.claim_item.output.safeParse({ item: { ...workItem, createdBy: "persona:abc" } })
        .success,
    ).toBe(false);
    expect(
      tools.claim_item.output.safeParse({ item: { ...workItem, createdBy: "robot" } }).success,
    ).toBe(false);
    expect(WorkerId.safeParse("build-2").success).toBe(true);
    expect(WorkerId.safeParse("Build_2").success).toBe(false);
  });

  it("allows a guard only on a guard rejection", () => {
    expect(Rejection.safeParse({ code: "NOT_FOUND", guard: "tenancy", reason: "x" }).success).toBe(
      false,
    );
  });

  it("maps each rejection to its counter, except RUN_PENDING", () => {
    expect(rejectionCounter("deps", "DEPS_OPEN")).toBe("rejectedClaims");
    expect(rejectionCounter("lease", "LEASE_HELD")).toBe("rejectedClaims");
    expect(rejectionCounter("lease", "LEASE_ENDED")).toBe("rejectedWrites"); // heartbeat, complete_*
    expect(rejectionCounter("lease", "LEASE_OTHER_WORKER")).toBe("rejectedWrites");
    expect(rejectionCounter("evidence", "NO_TESTS")).toBe("rejectedCompletions");
    expect(rejectionCounter("evidence", "RUN_PENDING")).toBeNull();
    expect(rejectionCounter("read-only", "WRITE_CLAUSE")).toBe("rejectedQueries");
    expect(rejectionCounter("source", "SOURCE_MISSING")).toBe("rejectedWrites");
  });

  it("maps each error to its HTTP status", () => {
    expect(httpStatus({ code: "VALIDATION_FAILED", reason: "x" })).toBe(400);
    expect(httpStatus({ code: "GUARD_REJECTED", guard: "tenancy", reason: "x" })).toBe(403);
    expect(httpStatus({ code: "GUARD_REJECTED", guard: "version", reason: "x" })).toBe(409);
    expect(httpStatus({ code: "GUARD_REJECTED", guard: "anonymity", reason: "x" })).toBe(422);
    expect(httpStatus({ code: "GRAPH_UNAVAILABLE", reason: "x" })).toBe(503);
  });

  it("bands clarity at 3 and 6 questions per 1,000 words", () => {
    expect(clarityBand(2.99)).toBe("high");
    expect(clarityBand(3)).toBe("medium");
    expect(clarityBand(5.99)).toBe("medium");
    expect(clarityBand(6)).toBe("low");
  });
});
