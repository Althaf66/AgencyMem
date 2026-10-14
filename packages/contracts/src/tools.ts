// contracts.md section 7: the input and output schema of every MCP tool.
import { z } from "zod";
import {
  Attribute,
  CardKey,
  CaseMetrics,
  Count,
  CriterionKey,
  DESIGN_KEY_PREFIX,
  DesignKey,
  EntityKey,
  EpochMs,
  FeatureKey,
  Id,
  ProjectInfo,
  ReadinessCheck,
  RequirementKey,
  RunInput,
  Sha,
  text,
} from "./common";
import {
  AgentId,
  AssumptionStatus,
  ChangeRequestStatus,
  ClarityBand,
  Column,
  DefectSeverity,
  DesignLabel,
  Doc,
  EpisodeKind,
  FeatureKind,
  HttpMethod,
  Lane,
  Priority,
  QuestionKind,
  QuestionStatus,
  TaskKind,
  WorkItemKind,
  WorkItemStatus,
} from "./enums";
import { WorkItem } from "./nodes";

const Version = z.int().min(1);

// claim_item

export const ClaimItemInput = z.object({
  kinds: z.array(WorkItemKind).optional(),
  itemId: Id.optional(),
});
export const ClaimItemOutput = z.object({ item: WorkItem.nullable() });

// heartbeat

export const HeartbeatInput = z.object({ itemId: Id }); // a WorkItem id or a Task id
export const HeartbeatOutput = z.object({ leaseUntil: EpochMs });

// complete_item

export const CompleteItemInput = z.object({
  itemId: Id,
  outcome: z.enum(["done", "failed"]),
  note: text(1000).optional(),
  runs: z.array(RunInput),
  result: z
    .object({ mergedSha: Sha.optional(), conflictFiles: z.array(z.string()).optional() })
    .optional(), // merge items only
});
export const CompleteItemOutput = z.object({
  item: z.object({ id: Id, status: WorkItemStatus, attempts: Count }),
  opened: z.array(z.object({ id: Id, kind: WorkItemKind })),
});

// recall_context

export const Context = z.object({
  handoffs: z
    .array(z.object({ kind: WorkItemKind, agent: AgentId, summary: z.string(), doneAt: EpochMs }))
    .optional(),
  documents: z.array(z.object({ id: Id, name: z.string(), wordCount: Count })).optional(),
  episodes: z
    .array(
      z.object({
        id: Id,
        kind: EpisodeKind,
        documentName: z.string().nullable(),
        page: z.int().nullable(),
        lineStart: z.int().nullable(),
        lineEnd: z.int().nullable(),
        text: z.string(),
      }),
    )
    .optional(),
  entities: z
    .array(z.object({ key: EntityKey, name: z.string(), aliases: z.array(z.string()) }))
    .optional(),
  facts: z
    .array(
      z.object({
        id: Id,
        statement: z.string(),
        subject: z.string(),
        attribute: z.string(),
        value: z.string(),
        episodeIds: z.array(Id),
        validTo: EpochMs.nullable(),
        replacedBy: Id.nullable(),
      }),
    )
    .optional(),
  questions: z
    .array(
      z.object({
        id: Id,
        kind: QuestionKind,
        text: z.string(),
        recommended: z.string(),
        status: QuestionStatus,
        factIds: z.array(Id),
        assumption: z.object({ id: Id, text: z.string(), status: AssumptionStatus }),
        answer: z.object({ episodeId: Id, text: z.string() }).nullable(),
      }),
    )
    .optional(),
  changeRequest: z
    .object({ id: Id, text: z.string(), episodeId: Id, status: ChangeRequestStatus })
    .optional(),
  requirements: z
    .array(
      z.object({
        id: Id,
        key: RequirementKey,
        text: z.string(),
        priority: Priority,
        factIds: z.array(Id),
        version: Version,
      }),
    )
    .optional(),
  features: z
    .array(
      z.object({
        id: Id,
        key: FeatureKey,
        name: z.string(),
        featureKind: FeatureKind,
        requirementKeys: z.array(RequirementKey),
        estimate: z.object({
          id: Id,
          hours: z.number(),
          rawHours: z.number(),
          basis: z.string(),
          lessonIds: z.array(Id),
        }),
        actualHours: z.number().nullable(),
      }),
    )
    .optional(),
  lessons: z
    .array(
      z.object({
        id: Id,
        featureKind: FeatureKind,
        clarityBand: ClarityBand,
        ratio: z.number(),
        n: Count,
        text: z.string(),
      }),
    )
    .optional(),
  design: z
    .array(
      z.object({
        id: Id,
        label: DesignLabel,
        key: DesignKey,
        name: z.string(),
        body: z.string(),
        method: z.string().optional(),
        path: z.string().optional(),
        requirementKeys: z.array(RequirementKey),
      }),
    )
    .optional(),
  docSections: z
    .array(
      z.object({
        id: Id,
        doc: Doc,
        order: z.int(),
        title: z.string(),
        body: z.string(),
        stale: z.boolean(),
        renders: z.array(z.string()),
      }),
    )
    .optional(),
  tasks: z
    .array(
      z.object({
        id: Id,
        key: CardKey,
        title: z.string(),
        description: z.string(),
        lane: Lane,
        column: Column,
        kind: TaskKind,
        version: Version,
        requirementKey: RequirementKey,
        designKeys: z.array(DesignKey),
        dependsOn: z.array(CardKey),
        criteria: z.array(
          z.object({ id: Id, key: CriterionKey, text: z.string(), testIds: z.array(z.string()) }),
        ),
        testCases: z.array(
          z.object({ id: Id, file: z.string(), title: z.string(), criterionKey: CriterionKey }),
        ),
      }),
    )
    .optional(),
  codeChanges: z
    .array(
      z.object({
        id: Id,
        sha: Sha,
        branch: z.string(),
        taskKey: CardKey.nullable(),
        files: z.array(z.string()),
        message: z.string(),
        committedAt: EpochMs,
        linked: z.boolean(),
      }),
    )
    .optional(),
  defect: z.object({ reportEpisodeId: Id, text: z.string() }).optional(),
  readiness: z.array(ReadinessCheck).optional(), // launch only
  metrics: CaseMetrics.optional(), // curator only
});
export type Context = z.infer<typeof Context>;

export const RecallContextInput = z.object({ itemId: Id });
export const RecallContextOutput = z.object({
  item: WorkItem,
  project: ProjectInfo,
  context: Context,
  chars: Count,
});

// write_handoff

export const WriteHandoffInput = z.object({
  itemId: Id,
  summary: z.string().min(1).max(2000),
  outputIds: z.array(Id),
  report: z.object({ checks: z.array(ReadinessCheck) }).optional(), // launch only
});
export const WriteHandoffOutput = z.object({ itemId: Id, reportId: Id.nullable() });

// write_fact

export const FactInput = z.object({
  statement: text(300),
  subject: EntityKey,
  attribute: Attribute,
  value: text(200),
  entity: z.object({ key: EntityKey, name: text(80), aliases: z.array(z.string()) }),
  episodeIds: z.array(Id).min(1),
  replacesFactId: Id.optional(), // intake_answer only
});
export type FactInput = z.infer<typeof FactInput>;
export const WriteFactInput = z.object({ itemId: Id, facts: z.array(FactInput).min(1).max(200) });
export const WriteFactOutput = z.object({
  factIds: z.array(Id),
  entityIds: z.array(Id),
  superseded: z.array(Id),
});

// write_question

export const QuestionInput = z
  .object({
    kind: QuestionKind,
    text: text(200).endsWith("?"),
    recommended: text(400),
    reasoning: text(600),
    approach: text(600),
    assumption: text(300),
    factIds: z.array(Id).min(1),
    contradiction: z.object({ summary: text(300) }).optional(),
  })
  .superRefine((q, ctx) => {
    if (q.kind !== "contradiction") return;
    if (q.factIds.length < 2) {
      ctx.addIssue({
        code: "custom",
        path: ["factIds"],
        message: "a contradiction needs at least 2 facts",
      });
    }
    if (!q.contradiction) {
      ctx.addIssue({
        code: "custom",
        path: ["contradiction"],
        message: "required when kind is contradiction",
      });
    }
  });
export type QuestionInput = z.infer<typeof QuestionInput>;
export const WriteQuestionInput = z.object({
  itemId: Id,
  questions: z.array(QuestionInput).max(20),
});
export const WriteQuestionOutput = z.object({
  questionIds: z.array(Id),
  contradictionIds: z.array(Id),
  assumptionIds: z.array(Id),
});

// write_product

export const RequirementInput = z.object({
  key: RequirementKey,
  text: text(300),
  priority: Priority,
  factIds: z.array(Id).min(1),
});
export type RequirementInput = z.infer<typeof RequirementInput>;
export const FeatureInput = z.object({
  key: FeatureKey,
  name: text(80),
  featureKind: FeatureKind,
  requirementKeys: z.array(RequirementKey).min(1),
  estimate: z.object({
    rawHours: z.number().min(0.5).max(40),
    hours: z.number().nonnegative(),
    basis: text(200),
    lessonIds: z.array(Id),
  }),
});
export type FeatureInput = z.infer<typeof FeatureInput>;
export const WriteProductInput = z.object({
  itemId: Id,
  baseVersion: Count,
  requirements: z.array(RequirementInput),
  features: z.array(FeatureInput),
});
export const WriteProductOutput = z.object({
  productVersion: z.int().min(1),
  requirementIds: z.array(Id),
  featureIds: z.array(Id),
  estimateIds: z.array(Id),
  ended: z.array(Id),
});

// record_change_request

export const RecordChangeRequestInput = z
  .object({
    itemId: Id,
    crId: Id,
    changes: z.array(z.object({ oldFactId: Id, statement: text(300), value: text(200) })).max(10),
    outcome: z.literal("needs_scope").optional(),
  })
  .refine((r) => r.outcome === undefined || r.changes.length === 0, {
    message: "needs_scope comes with no changes",
    path: ["outcome"],
  });
export const RecordChangeRequestOutput = z.object({
  newFactIds: z.array(Id),
  flagged: z.object({ taskIds: z.array(Id), docSectionIds: z.array(Id) }),
  crStatus: ChangeRequestStatus,
});

// find_impact

export const FindImpactInput = z.object({ factId: Id });
export const FindImpactOutput = z.object({
  nodes: z.array(z.object({ type: z.string(), id: Id, label: z.string() })),
});

// write_design

export const DesignNodeInput = z
  .object({
    label: DesignLabel,
    key: DesignKey,
    name: text(80),
    body: text(1500),
    method: HttpMethod.optional(), // Endpoint only
    path: z.string().startsWith("/").optional(), // Endpoint only
    requirementKeys: z.array(RequirementKey).min(1),
  })
  .superRefine((n, ctx) => {
    if (!n.key.startsWith(`${DESIGN_KEY_PREFIX[n.label]}-`)) {
      ctx.addIssue({
        code: "custom",
        path: ["key"],
        message: `a ${n.label} key starts with ${DESIGN_KEY_PREFIX[n.label]}-`,
      });
    }
    const isEndpoint = n.label === "Endpoint";
    if (isEndpoint !== (n.method !== undefined) || isEndpoint !== (n.path !== undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["method"],
        message: "method and path are set on an Endpoint only",
      });
    }
  });
export type DesignNodeInput = z.infer<typeof DesignNodeInput>;
export const DocSectionInput = z.object({
  doc: Doc,
  order: z.int().min(1),
  title: text(80),
  body: text(1500), // Markdown
  renders: z.array(z.string()).min(1), // keys of Requirements, Features or design nodes
});
export type DocSectionInput = z.infer<typeof DocSectionInput>;
export const WriteDesignInput = z.object({
  itemId: Id,
  baseVersion: Count,
  nodes: z.array(DesignNodeInput),
  sections: z.array(DocSectionInput),
});
export const WriteDesignOutput = z.object({
  designVersion: z.int().min(1),
  nodeIds: z.array(Id),
  sectionIds: z.array(Id),
});

// write_cards

export const CardInput = z.object({
  key: CardKey,
  version: Version.optional(), // required in update mode
  title: text(80),
  description: text(1200),
  lane: Lane,
  order: z.int(),
  requirementKey: RequirementKey,
  designKeys: z.array(DesignKey),
  dependsOn: z.array(CardKey),
  criteria: z
    .array(z.object({ key: CriterionKey, text: text(300), testIds: z.array(z.string()).min(1) }))
    .min(1)
    .max(3),
});
export type CardInput = z.infer<typeof CardInput>;
export const WriteCardsInput = z
  .object({
    itemId: Id,
    mode: z.enum(["create", "update"]),
    cards: z.array(CardInput).min(1).max(12),
  })
  .superRefine((w, ctx) => {
    if (w.mode !== "update") return;
    w.cards.forEach((card, i) => {
      if (card.version === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["cards", i, "version"],
          message: "required in update mode",
        });
      }
    });
  });
export const WriteCardsOutput = z.object({ taskIds: z.array(Id), criterionIds: z.array(Id) });

// write_tests

export const WriteTestsInput = z.object({
  itemId: Id,
  taskId: Id,
  sha: Sha,
  cases: z.array(z.object({ criterionKey: CriterionKey, file: z.string(), title: text(200) })),
});
export const WriteTestsOutput = z.object({ testCaseIds: z.array(Id), taskColumn: Column });

// submit_test_run

export const SubmitTestRunInput = z.object({
  itemId: Id,
  sha: Sha,
  taskId: Id.optional(),
  results: z
    .array(
      z.object({
        testCaseId: Id,
        passed: z.boolean(),
        durationMs: Count,
        error: text(500).optional(),
      }),
    )
    .min(1),
});
export const SubmitTestRunOutput = z.object({
  testRunIds: z.array(Id),
  allPassed: z.boolean(),
  taskColumn: Column.nullable(),
});

// claim_task

export const ClaimTaskInput = z.object({ taskId: Id.optional() });
export const ClaimTaskOutput = z.object({
  task: z
    .object({
      id: Id,
      key: CardKey,
      title: z.string(),
      version: Version,
      column: Column,
      lane: Lane,
      kind: TaskKind,
      attempts: Count,
      branch: z.string(), // always card/<key>
    })
    .nullable(),
});

// get_task_context

const Excerpt = z.object({
  documentName: z.string().nullable(),
  page: z.int().nullable(),
  lineStart: z.int().nullable(),
  lineEnd: z.int().nullable(),
  excerpt: z.string(),
});
export const GetTaskContextInput = z.object({ taskId: Id });
export const GetTaskContextOutput = z.object({
  task: z.object({
    id: Id,
    key: CardKey,
    title: z.string(),
    description: z.string(),
    lane: Lane,
    kind: TaskKind,
    version: Version,
    branch: z.string(),
    note: z.string().nullable(),
  }),
  requirement: z.object({
    key: RequirementKey,
    text: z.string(),
    facts: z.array(z.object({ id: Id, statement: z.string() })),
  }),
  criteria: z.array(
    z.object({ key: CriterionKey, text: z.string(), testIds: z.array(z.string()) }),
  ),
  design: z.array(
    z.object({
      label: DesignLabel,
      key: DesignKey,
      name: z.string(),
      body: z.string(),
      method: z.string().optional(),
      path: z.string().optional(),
    }),
  ),
  testCases: z.array(z.object({ file: z.string(), title: z.string(), criterionKey: CriterionKey })),
  codeChanges: z.array(
    z.object({ sha: Sha, message: z.string(), files: z.array(z.string()), committedAt: EpochMs }),
  ),
  episodes: z.array(Excerpt),
  defect: z.object({ title: z.string(), report: z.string() }).nullable(), // fix cards only
  conventions: z.object({ testIdRule: z.string(), stack: z.string() }),
  truncated: z.boolean(),
  chars: Count,
});

// complete_task

export const CompleteTaskInput = z.object({
  taskId: Id,
  version: Version,
  outcome: z.enum(["done", "failed"]).optional(), // done is the default
  note: text(500).optional(),
});
export const CompleteTaskOutput = z.object({
  task: z.object({ id: Id, key: CardKey, column: Column, version: Version }),
});

// report_defect

export const ReportDefectInput = z.object({
  itemId: Id,
  title: text(120),
  severity: DefectSeverity,
  codeChangeId: Id,
  reportEpisodeId: Id,
  reasoning: text(600),
});
export const ReportDefectOutput = z.object({ defectId: Id });

// propose_fix

export const ProposeFixInput = z.object({
  itemId: Id,
  defectId: Id,
  card: CardInput.omit({ version: true }),
});
export const ProposeFixOutput = z.object({ taskId: Id, gateId: Id });

// write_case_study

export const WriteCaseStudyInput = z.object({
  itemId: Id,
  caseStudy: z.object({ metrics: CaseMetrics, lessonsLearned: text(1500) }),
  records: z.array(
    z.object({
      featureKind: FeatureKind,
      clarityBand: ClarityBand,
      estimate: z.number().nonnegative(),
      raw: z.number().nonnegative(),
      actual: z.number().nonnegative(),
    }),
  ),
  lessons: z.array(
    z.object({ featureKind: FeatureKind, clarityBand: ClarityBand, text: text(300) }),
  ),
});
export const WriteCaseStudyOutput = z.object({
  caseStudyId: Id,
  recordIds: z.array(Id),
  lessonIds: z.array(Id),
});

// read_query

export const ReadQueryInput = z.object({
  graph: z.enum(["client", "agency"]),
  cypher: z.string().min(1).max(4000),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});
export const ReadQueryOutput = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.array(z.unknown())),
  ms: z.number().nonnegative(),
  truncated: z.boolean(),
});

/** All 21 MCP tools: name → input and output schema. */
export const tools = {
  claim_item: { input: ClaimItemInput, output: ClaimItemOutput },
  heartbeat: { input: HeartbeatInput, output: HeartbeatOutput },
  complete_item: { input: CompleteItemInput, output: CompleteItemOutput },
  recall_context: { input: RecallContextInput, output: RecallContextOutput },
  write_handoff: { input: WriteHandoffInput, output: WriteHandoffOutput },
  write_fact: { input: WriteFactInput, output: WriteFactOutput },
  write_question: { input: WriteQuestionInput, output: WriteQuestionOutput },
  write_product: { input: WriteProductInput, output: WriteProductOutput },
  record_change_request: { input: RecordChangeRequestInput, output: RecordChangeRequestOutput },
  find_impact: { input: FindImpactInput, output: FindImpactOutput },
  write_design: { input: WriteDesignInput, output: WriteDesignOutput },
  write_cards: { input: WriteCardsInput, output: WriteCardsOutput },
  write_tests: { input: WriteTestsInput, output: WriteTestsOutput },
  submit_test_run: { input: SubmitTestRunInput, output: SubmitTestRunOutput },
  claim_task: { input: ClaimTaskInput, output: ClaimTaskOutput },
  get_task_context: { input: GetTaskContextInput, output: GetTaskContextOutput },
  complete_task: { input: CompleteTaskInput, output: CompleteTaskOutput },
  report_defect: { input: ReportDefectInput, output: ReportDefectOutput },
  propose_fix: { input: ProposeFixInput, output: ProposeFixOutput },
  write_case_study: { input: WriteCaseStudyInput, output: WriteCaseStudyOutput },
  read_query: { input: ReadQueryInput, output: ReadQueryOutput },
} as const;

export const ToolName = z.enum(
  Object.keys(tools) as [keyof typeof tools, ...(keyof typeof tools)[]],
);
export type ToolName = z.infer<typeof ToolName>;
