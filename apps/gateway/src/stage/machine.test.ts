// stage-machine.md section 1, rule 4: one row per transition.
import { describe, expect, it } from "vitest";
import type { Actor } from "@agencymem/contracts";
import { next, type Effect, type StageEvent, type StageResult, type StageState } from "./machine";

const ana = "human:ana" as const;
const D1 = "01JA0000000000000000000001";
const D2 = "01JA0000000000000000000002";
const fresh: StageState = {
  stage: "intake",
  createdBy: ana,
  gates: [],
  unopened: [],
  openIntake: 0,
  processedDocuments: 0,
  g1: null,
  openIntakeAnswer: 0,
  unopenedAnswers: [],
  g2: null,
  openProposal: 0,
  lastProposal: null,
  changeRequests: [],
  unopenedEdits: [],
  g3: null,
  lastRevision: null,
  plannerDone: false,
  untestedCards: [],
  readyCards: 0,
  buildCards: { total: 0, merged: 0 },
  buildBlockers: 0,
  lastE2e: null,
  g5: null,
  unopenedBugs: [],
  approvedFixes: [],
  closedAt: null,
  curatorDone: false,
};
const ALL_GATES: StageState["gates"] = ["G1", "G2", "G3", "G5"];
const intakeDone = (over: Partial<StageState> = {}): StageState => ({
  ...fresh,
  gates: ALL_GATES,
  processedDocuments: 2,
  ...over,
});
const openDiscovery = {
  type: "open_item",
  kind: "discovery",
  subjectId: null,
  createdBy: "intake",
} as const;

const EP = "01JA00000000000000000000E1";
const answering = (over: Partial<StageState> = {}): StageState =>
  intakeDone({ stage: "discovery", g1: "waiting", ...over });
const openProposal = (createdBy: Actor) =>
  ({ type: "open_item", kind: "proposal", subjectId: null, createdBy }) as const;
const approveG1 = { type: "gate_decided", key: "G1", decision: "approve", actor: ana } as const;
const answerDone = {
  type: "item_completed",
  kind: "intake_answer",
  outcome: "done",
  actor: "intake",
} as const;

const rows: [string, StageState, StageEvent, StageResult][] = [
  [
    "T1 project created: gates G1, G2, G3 and G5, stage intake",
    fresh,
    { type: "project_created", actor: ana },
    { effects: [{ type: "create_gates", keys: ["G1", "G2", "G3", "G5"], createdBy: ana }] },
  ],
  [
    "T2 files uploaded: an intake item per processed Document, none for no_text or failed",
    { ...fresh, gates: ["G1", "G2", "G3", "G5"] },
    {
      type: "files_uploaded",
      actor: ana,
      documents: [
        { id: D1, status: "processed" },
        { id: "01JA0000000000000000000003", status: "no_text" },
        { id: "01JA0000000000000000000004", status: "failed" },
        { id: D2, status: "processed" },
      ],
    },
    {
      effects: [
        { type: "open_item", kind: "intake", subjectId: D1, createdBy: ana },
        { type: "open_item", kind: "intake", subjectId: D2, createdBy: ana },
      ],
    },
  ],
  [
    "startup repairs missing gates and a processed Document that never got its intake item",
    {
      ...fresh,
      gates: ["G1", "G3"],
      unopened: [{ documentId: D1, createdBy: "persona:01JA0000000000000000000009" }],
      processedDocuments: 1,
    },
    { type: "startup" },
    {
      effects: [
        { type: "create_gates", keys: ["G2", "G5"], createdBy: ana },
        {
          type: "open_item",
          kind: "intake",
          subjectId: D1,
          createdBy: "persona:01JA0000000000000000000009",
        },
      ],
    },
  ],
  [
    "T3 the last intake item done: opens discovery, stage discovery",
    intakeDone(),
    { type: "item_completed", kind: "intake", outcome: "done", actor: "intake" },
    { stage: "discovery", effects: [openDiscovery] },
  ],
  [
    "T3 waits while another intake item is open or claimed",
    intakeDone({ openIntake: 1 }),
    { type: "item_completed", kind: "intake", outcome: "done", actor: "intake" },
    { effects: [] },
  ],
  [
    "T3 does not fire on a failed intake item",
    intakeDone(),
    { type: "item_completed", kind: "intake", outcome: "failed", actor: "intake" },
    { effects: [] },
  ],
  [
    "T3 does not fire outside intake",
    intakeDone({ stage: "discovery" }),
    { type: "item_completed", kind: "intake", outcome: "done", actor: "intake" },
    { effects: [] },
  ],
  [
    "T4 discovery done: no effects (G1 is decidable once no Question is open, read from the gates)",
    intakeDone({ stage: "discovery" }),
    { type: "item_completed", kind: "discovery", outcome: "done", actor: "discovery" },
    { effects: [] },
  ],
  [
    "T5 a question answered: opens intake_answer for the answer Episode",
    answering(),
    { type: "question_answered", episodeId: EP, actor: ana },
    { effects: [{ type: "open_item", kind: "intake_answer", subjectId: EP, createdBy: ana }] },
  ],
  [
    "T6 G1 approved with no intake_answer item left: opens proposal, stage proposal",
    answering({ g1: "approved" }),
    approveG1,
    { stage: "proposal", effects: [openProposal(ana)] },
  ],
  [
    "T6 G1 approved while an intake_answer item is open: stays in discovery until T7",
    answering({ g1: "approved", openIntakeAnswer: 1 }),
    approveG1,
    { effects: [] },
  ],
  [
    "T6 waits for an answer written a moment ago whose intake_answer item is not open yet",
    answering({ g1: "approved", unopenedAnswers: [{ episodeId: EP, createdBy: ana }] }),
    approveG1,
    { effects: [] },
  ],
  [
    "T7 the last intake_answer item done after G1: opens proposal, stage proposal",
    answering({ g1: "approved" }),
    answerDone,
    { stage: "proposal", effects: [openProposal("intake")] },
  ],
  [
    "T7 waits while another intake_answer item is open or claimed",
    answering({ g1: "approved", openIntakeAnswer: 1 }),
    answerDone,
    { effects: [] },
  ],
  ["T7 waits while G1 is not approved", answering(), answerDone, { effects: [] }],
  [
    "T7 does not fire once the stage has moved on (T6 opened proposal)",
    answering({ g1: "approved", stage: "proposal" }),
    answerDone,
    { effects: [] },
  ],
  [
    "T7 does not fire on a failed intake_answer item",
    answering({ g1: "approved" }),
    { ...answerDone, outcome: "failed" },
    { effects: [] },
  ],
  [
    "startup repairs a missed T5: an answer Episode that never got its intake_answer item",
    answering({ g1: "approved", unopenedAnswers: [{ episodeId: EP, createdBy: ana }] }),
    { type: "startup" },
    { effects: [{ type: "open_item", kind: "intake_answer", subjectId: EP, createdBy: ana }] },
  ],
  [
    "startup repairs a missed T6 or T7: G1 approved, every intake_answer item done, in discovery",
    answering({ g1: "approved" }),
    { type: "startup" },
    { stage: "proposal", effects: [openProposal("intake")] },
  ],
  [
    "startup repairs a missed T3: every intake item done, still in intake",
    intakeDone(),
    { type: "startup" },
    { stage: "discovery", effects: [openDiscovery] },
  ],
  [
    "startup with nothing half done does nothing",
    { ...fresh, gates: ["G1", "G2", "G3", "G5"] },
    { type: "startup" },
    { effects: [] },
  ],
];

const persona = "persona:01JA0000000000000000000009" as const;
const REASON = "estimate too high, cut scope";
const proposing = (over: Partial<StageState> = {}): StageState =>
  intakeDone({
    stage: "proposal",
    g1: "approved",
    g2: { status: "waiting", reason: null, decidedAt: null, decidedBy: null },
    lastProposal: { createdAt: 50, doneAt: 60 },
    ...over,
  });
const rejectedG2 = {
  status: "rejected",
  reason: REASON,
  decidedAt: 100,
  decidedBy: persona,
} as const;
const proposalDone = {
  type: "item_completed",
  kind: "proposal",
  outcome: "done",
  actor: "proposal",
} as const;
const openArchitect = (createdBy: Actor) =>
  ({ type: "open_item", kind: "architect", subjectId: null, createdBy }) as const;

rows.push(
  [
    "T8 a revision done after a G2 rejection: G2 back to waiting",
    proposing({ g2: rejectedG2, lastProposal: { createdAt: 150, doneAt: 200 } }),
    proposalDone,
    { effects: [{ type: "reopen_gate", key: "G2" }] },
  ],
  [
    "T8 the first proposal done: nothing to reopen (G2 is decidable, read from the gates)",
    proposing(),
    proposalDone,
    { effects: [] },
  ],
  [
    "T8 does not fire on a failed proposal item",
    proposing({ g2: rejectedG2 }),
    { ...proposalDone, outcome: "failed" },
    { effects: [] },
  ],
  [
    "T9 G2 rejected with a reason: opens proposal with the reason as its note",
    proposing(),
    { type: "gate_decided", key: "G2", decision: "reject", reason: REASON, actor: persona },
    {
      effects: [
        { type: "open_item", kind: "proposal", subjectId: null, createdBy: persona, note: REASON },
      ],
    },
  ],
  [
    "T10 G2 approved: opens architect, stage design",
    proposing(),
    { type: "gate_decided", key: "G2", decision: "approve", actor: persona },
    { stage: "design", effects: [openArchitect(persona)] },
  ],
  [
    "startup repairs a missed T9: G2 rejected and no proposal item opened since",
    proposing({ g2: rejectedG2 }),
    { type: "startup" },
    {
      effects: [
        { type: "open_item", kind: "proposal", subjectId: null, createdBy: persona, note: REASON },
      ],
    },
  ],
  [
    "startup waits while the revision is open or claimed",
    proposing({ g2: rejectedG2, openProposal: 1, lastProposal: { createdAt: 150, doneAt: null } }),
    { type: "startup" },
    { effects: [] },
  ],
  [
    "startup repairs a missed T8: the revision is done but G2 is still rejected",
    proposing({ g2: rejectedG2, lastProposal: { createdAt: 150, doneAt: 200 } }),
    { type: "startup" },
    { effects: [{ type: "reopen_gate", key: "G2" }] },
  ],
  [
    "startup repairs a missed T10: G2 approved, still in proposal",
    proposing({ g2: { ...rejectedG2, status: "approved", reason: null } }),
    { type: "startup" },
    { stage: "design", effects: [openArchitect(persona)] },
  ],
  [
    "startup with the proposal waiting for G2 does nothing",
    proposing(),
    { type: "startup" },
    { effects: [] },
  ],
);

const CR = "01JA00000000000000000000C1";
const building = (cr: Partial<StageState["changeRequests"][number]> = {}): StageState =>
  intakeDone({
    stage: "build",
    changeRequests: [
      {
        id: CR,
        text: "Rule 1 is now B.",
        status: "applied",
        createdBy: ana,
        hasItem: true,
        itemDone: true,
        tasks: 3,
        sections: 2,
        revise: false,
        replan: false,
        replanDone: false,
        reworkTasks: [],
        ...cr,
      },
    ],
  });
const crDone = {
  type: "item_completed",
  kind: "change_request",
  outcome: "done",
  actor: "proposal",
  subjectId: CR,
} as const;
const openRevise = {
  type: "open_item",
  kind: "architect_revise",
  subjectId: CR,
  createdBy: "proposal",
  note: "Rule 1 is now B.",
} as const;
const openReplan = {
  type: "open_item",
  kind: "replan",
  subjectId: CR,
  createdBy: "proposal",
} as const;

rows.push(
  [
    "C1 a change request created: opens change_request for it",
    building({ status: "open", hasItem: false, itemDone: false, tasks: 0, sections: 0 }),
    { type: "change_request_created", crId: CR, actor: ana },
    { effects: [{ type: "open_item", kind: "change_request", subjectId: CR, createdBy: ana }] },
  ],
  [
    "C2 the CR applied with flagged cards and sections: opens architect_revise and replan",
    building(),
    crDone,
    { effects: [openRevise, openReplan] },
  ],
  [
    "C2 only sections flagged: opens architect_revise",
    building({ tasks: 0 }),
    crDone,
    { effects: [openRevise] },
  ],
  [
    "C2 only cards flagged: opens replan",
    building({ sections: 0 }),
    crDone,
    { effects: [openReplan] },
  ],
  [
    "C4 a CR with status no_change or needs_scope: nothing else",
    building({ status: "no_change", tasks: 0, sections: 0 }),
    crDone,
    { effects: [] },
  ],
  [
    "C2 does not fire on a failed change_request item",
    building({ itemDone: false }),
    { ...crDone, outcome: "failed" },
    { effects: [] },
  ],
  [
    "startup repairs a missed C1: a CR with no change_request item",
    building({ status: "open", hasItem: false, itemDone: false, tasks: 0, sections: 0 }),
    { type: "startup" },
    { effects: [{ type: "open_item", kind: "change_request", subjectId: CR, createdBy: ana }] },
  ],
  [
    "startup repairs a missed C2: the CR is applied and done, replan never opened",
    building({ revise: true }),
    { type: "startup" },
    { effects: [openReplan] },
  ],
  [
    "startup with every follow-up of the CR open does nothing",
    building({ revise: true, replan: true }),
    { type: "startup" },
    { effects: [] },
  ],
);

const EDIT = "01JA00000000000000000000H1";
const NOTE = 'On section "Summary" (prd 0): say the clinic name first.';
rows.push(
  [
    "T12 chat before G3: opens architect_revise for the human_edit episode, the text as its note",
    intakeDone({ stage: "design" }),
    { type: "chat", episodeId: EDIT, note: NOTE, actor: ana },
    {
      effects: [
        {
          type: "open_item",
          kind: "architect_revise",
          subjectId: EDIT,
          createdBy: ana,
          note: NOTE,
        },
      ],
    },
  ],
  [
    "startup repairs a missed T12: a human_edit episode that never got its architect_revise item",
    intakeDone({
      stage: "design",
      unopenedEdits: [{ episodeId: EDIT, text: "Say the clinic name first.", createdBy: ana }],
    }),
    { type: "startup" },
    {
      effects: [
        {
          type: "open_item",
          kind: "architect_revise",
          subjectId: EDIT,
          createdBy: ana,
          note: "Say the clinic name first.",
        },
      ],
    },
  ],
);

const G3_REASON = "the plan misses the admin screens";
const designing = (over: Partial<StageState> = {}): StageState =>
  intakeDone({
    stage: "design",
    g1: "approved",
    g2: { status: "approved", reason: null, decidedAt: 90, decidedBy: persona },
    g3: { status: "waiting", reason: null, decidedAt: null, decidedBy: null },
    ...over,
  });
const rejectedG3 = {
  status: "rejected",
  reason: G3_REASON,
  decidedAt: 300,
  decidedBy: ana,
} as const;
const reviseDone = {
  type: "item_completed",
  kind: "architect_revise",
  outcome: "done",
  actor: "architect",
} as const;
const openG3Revision = {
  type: "open_item",
  kind: "architect_revise",
  subjectId: null,
  createdBy: ana,
  note: G3_REASON,
} as const;
const openPlanner = (createdBy: Actor) =>
  ({ type: "open_item", kind: "planner", subjectId: null, createdBy }) as const;

rows.push(
  [
    "T11 architect done: nothing (G3 is decidable, read from the gates)",
    designing(),
    { type: "item_completed", kind: "architect", outcome: "done", actor: "architect" },
    { effects: [] },
  ],
  [
    "T11 architect_revise done with G3 waiting: nothing",
    designing({ lastRevision: { createdAt: 250, doneAt: 260 } }),
    reviseDone,
    { effects: [] },
  ],
  [
    "T13 G3 rejected with a reason: opens architect_revise with the reason as its note",
    designing(),
    { type: "gate_decided", key: "G3", decision: "reject", reason: G3_REASON, actor: ana },
    { effects: [openG3Revision] },
  ],
  [
    "T13 the revision done: G3 back to waiting",
    designing({ g3: rejectedG3, lastRevision: { createdAt: 310, doneAt: 400 } }),
    reviseDone,
    { effects: [{ type: "reopen_gate", key: "G3" }] },
  ],
  [
    "T13 a chat item done while the G3 revision is still open: nothing",
    designing({ g3: rejectedG3, lastRevision: { createdAt: 310, doneAt: null } }),
    reviseDone,
    { effects: [] },
  ],
  [
    "T14 G3 approved: opens planner, stage planning",
    designing(),
    { type: "gate_decided", key: "G3", decision: "approve", actor: ana },
    { stage: "planning", effects: [openPlanner(ana)] },
  ],
  [
    "startup repairs a missed T14: G3 approved, still in design",
    designing({ g3: { ...rejectedG3, status: "approved" } }),
    { type: "startup" },
    { stage: "planning", effects: [openPlanner(ana)] },
  ],
  [
    "startup repairs a missed T13: G3 rejected and no revision item since",
    designing({ g3: rejectedG3, lastRevision: { createdAt: 250, doneAt: 260 } }),
    { type: "startup" },
    { effects: [openG3Revision] },
  ],
  [
    "startup repairs a missed T13 return: the revision is done but G3 is still rejected",
    designing({ g3: rejectedG3, lastRevision: { createdAt: 310, doneAt: 400 } }),
    { type: "startup" },
    { effects: [{ type: "reopen_gate", key: "G3" }] },
  ],
  [
    "startup with the documents waiting for G3 does nothing",
    designing(),
    { type: "startup" },
    { effects: [] },
  ],
);

const CARD1 = "01JA00000000000000000000T1";
const CARD2 = "01JA00000000000000000000T2";
const planning = (over: Partial<StageState> = {}): StageState =>
  designing({
    stage: "planning",
    g3: { status: "approved", reason: null, decidedAt: 500, decidedBy: ana },
    plannerDone: true,
    untestedCards: [{ taskId: CARD1 }, { taskId: CARD2 }],
    ...over,
  });
const plannerDone = {
  type: "item_completed",
  kind: "planner",
  outcome: "done",
  actor: "planner",
} as const;
const openWriteTests = (taskId: string) =>
  ({ type: "open_item", kind: "write_tests", subjectId: taskId, createdBy: "planner" }) as const;

rows.push(
  [
    "T15 planner done: opens write_tests for each build card in Backlog",
    planning(),
    plannerDone,
    { effects: [openWriteTests(CARD1), openWriteTests(CARD2)] },
  ],
  [
    "T15 does not fire on a failed planner item",
    planning({ plannerDone: false }),
    { ...plannerDone, outcome: "failed" },
    { effects: [] },
  ],
  [
    "startup repairs a missed T15: planner done, a Backlog card with no write_tests item",
    planning({ untestedCards: [{ taskId: CARD2 }] }),
    { type: "startup" },
    { effects: [openWriteTests(CARD2)] },
  ],
  [
    "startup leaves the cards alone while the planner is still working",
    planning({ plannerDone: false }),
    { type: "startup" },
    { effects: [] },
  ],
);

rows.push(
  [
    "T16 the first card moves to Ready in planning: stage build",
    planning({ untestedCards: [], readyCards: 1 }),
    { type: "card_ready" },
    { stage: "build", effects: [] },
  ],
  [
    "T16 a card moves to Ready in build: nothing",
    planning({ stage: "build", untestedCards: [], readyCards: 2 }),
    { type: "card_ready" },
    { effects: [] },
  ],
  [
    "T16 with a card that never got its write_tests item: opens it with the move to build",
    planning({ untestedCards: [{ taskId: CARD2 }], readyCards: 1 }),
    { type: "card_ready" },
    { stage: "build", effects: [openWriteTests(CARD2)] },
  ],
  [
    "startup repairs a missed T15 after the build started",
    planning({ stage: "build", untestedCards: [{ taskId: CARD2 }], readyCards: 1 }),
    { type: "startup" },
    { effects: [openWriteTests(CARD2)] },
  ],
  [
    "H3 a person edited a card's criteria: opens write_tests for that card",
    planning({ stage: "build", untestedCards: [], readyCards: 1 }),
    { type: "criteria_edited", taskId: CARD1, actor: ana },
    { effects: [{ type: "open_item", kind: "write_tests", subjectId: CARD1, createdBy: ana }] },
  ],
  [
    "startup repairs a missed T16: in planning with a card already Ready",
    planning({ untestedCards: [], readyCards: 1 }),
    { type: "startup" },
    { stage: "build", effects: [] },
  ],
);

const T1 = "01JA00000000000000000000R1";
const T2 = "01JA00000000000000000000R2";
const tests = (taskId: string) =>
  ({ type: "open_item", kind: "write_tests", subjectId: taskId, createdBy: "planner" }) as const;
rows.push(
  [
    "C3 replan done: opens write_tests for each flagged card in Rework",
    building({ revise: true, replan: true, replanDone: true, reworkTasks: [T1, T2] }),
    { type: "item_completed", kind: "replan", outcome: "done", actor: "planner", subjectId: CR },
    { effects: [tests(T1), tests(T2)] },
  ],
  [
    "C3 does not fire on a failed replan item",
    building({ revise: true, replan: true, reworkTasks: [T1] }),
    { type: "item_completed", kind: "replan", outcome: "failed", actor: "planner", subjectId: CR },
    { effects: [] },
  ],
  [
    "startup repairs a missed C3: the replan is done, a flagged Rework card has no write_tests item",
    building({ revise: true, replan: true, replanDone: true, reworkTasks: [T2] }),
    { type: "startup" },
    { effects: [tests(T2)] },
  ],
  [
    "startup leaves flagged Rework cards alone while the replan is not done",
    building({ revise: true, replan: true, reworkTasks: [T2] }),
    { type: "startup" },
    { effects: [] },
  ],
);

// T20, T21 and T30 (task 5.1): the full e2e run after the last merge, launch after it, and back to
// build when a card leaves Done.
const merged = (over: Partial<StageState> = {}): StageState =>
  planning({
    stage: "build",
    untestedCards: [],
    readyCards: 2,
    buildCards: { total: 2, merged: 2 },
    ...over,
  });
const mergeDone = {
  type: "item_completed",
  kind: "merge",
  outcome: "done",
  actor: "build",
  subjectId: CARD2,
} as const;
const e2eDone = { type: "item_completed", kind: "e2e", outcome: "done", actor: "test" } as const;
const openE2e = (createdBy: Actor) =>
  ({ type: "open_item", kind: "e2e", subjectId: null, createdBy }) as const;
const openLaunch = {
  type: "open_item",
  kind: "launch",
  subjectId: null,
  createdBy: "test",
} as const;
const cancelRun: Effect = { type: "cancel_items", kinds: ["e2e", "launch"] };
const oneLeft = { total: 2, merged: 1 };
rows.push(
  [
    "T20 the last build card is merged: opens e2e, stage e2e",
    merged(),
    mergeDone,
    { stage: "e2e", effects: [openE2e("build")] },
  ],
  [
    "T20 does not fire while a build card is not merged",
    merged({ buildCards: oneLeft }),
    mergeDone,
    { effects: [] },
  ],
  [
    "T20 does not fire while a change_request, replan or write_tests item is open or claimed",
    merged({ buildBlockers: 1 }),
    mergeDone,
    { effects: [] },
  ],
  [
    "T20 does not fire on a failed merge item",
    merged(),
    { ...mergeDone, outcome: "failed" },
    { effects: [] },
  ],
  [
    "T20 does not apply to a fix card merged in maintenance",
    merged({ stage: "maintenance" }),
    mergeDone,
    { effects: [] },
  ],
  [
    "T20 a change request that flagged nothing finishes after the last merge: opens e2e",
    merged(),
    { ...crDone, subjectId: "01JA00000000000000000000C9" },
    { stage: "e2e", effects: [openE2e("proposal")] },
  ],
  [
    "startup repairs a missed T20: in build with every build card merged",
    merged(),
    { type: "startup" },
    { stage: "e2e", effects: [openE2e("build")] },
  ],
  [
    "T21 the e2e run is done: opens launch, stage launch",
    merged({ stage: "e2e" }),
    e2eDone,
    { stage: "launch", effects: [openLaunch] },
  ],
  [
    "T21 does not fire on a failed e2e item",
    merged({ stage: "e2e" }),
    { ...e2eDone, outcome: "failed" },
    { effects: [] },
  ],
  [
    "startup repairs a missed T21: in e2e with the newest e2e item done",
    merged({ stage: "e2e", lastE2e: "done" }),
    { type: "startup" },
    { stage: "launch", effects: [openLaunch] },
  ],
  [
    "startup leaves e2e alone while its item is still claimed",
    merged({ stage: "e2e", lastE2e: "claimed" }),
    { type: "startup" },
    { effects: [] },
  ],
  [
    "T30 a change request sent a Done card to Rework during e2e: replan, cancel the run, stage build",
    merged({
      stage: "e2e",
      buildCards: oneLeft,
      changeRequests: building({ sections: 0 }).changeRequests,
    }),
    crDone,
    {
      stage: "build",
      effects: [
        { type: "open_item", kind: "replan", subjectId: CR, createdBy: "proposal" },
        cancelRun,
      ],
    },
  ],
  [
    "T30 a person reopened a card during launch: cancel the run, stage build",
    merged({ stage: "launch", buildCards: oneLeft }),
    { type: "card_reopened" },
    { stage: "build", effects: [cancelRun] },
  ],
  [
    "a card reopened in build changes nothing",
    merged({ buildCards: oneLeft }),
    { type: "card_reopened" },
    { effects: [] },
  ],
  [
    "startup repairs a missed T30: in launch with a build card no longer Done",
    merged({ stage: "launch", buildCards: oneLeft }),
    { type: "startup" },
    { stage: "build", effects: [cancelRun] },
  ],
);

// T23 (task 5.2): G5 approved records the Deployment (the route) and starts maintenance.
const approveG5 = { type: "gate_decided", key: "G5", decision: "approve", actor: ana } as const;
rows.push(
  [
    "T23 G5 approved: stage maintenance",
    merged({ stage: "launch", g5: "approved" }),
    approveG5,
    { stage: "maintenance", effects: [] },
  ],
  [
    "startup repairs a missed T23: in launch with G5 approved",
    merged({ stage: "launch", g5: "approved" }),
    { type: "startup" },
    { stage: "maintenance", effects: [] },
  ],
  [
    "startup leaves launch alone while G5 waits",
    merged({ stage: "launch", g5: "waiting" }),
    { type: "startup" },
    { effects: [] },
  ],
);

// T24 and T26 (task 5.3): a bug report opens maintenance; G6 approved opens the fix card's tests.
const BUG = "01JA00000000000000000000B1";
const FIX = "01JA00000000000000000000X1";
const maintaining = (over: Partial<StageState> = {}) =>
  merged({ stage: "maintenance", g5: "approved", ...over });
const openMaintenance = (createdBy: Actor) =>
  ({ type: "open_item", kind: "maintenance", subjectId: BUG, createdBy }) as const;
rows.push(
  [
    "T24 a bug report: opens maintenance for its Episode",
    maintaining(),
    { type: "bug_reported", episodeId: BUG, actor: ana },
    { effects: [openMaintenance(ana)] },
  ],
  [
    "startup repairs a missed T24: a bug_report Episode with no maintenance item",
    maintaining({ unopenedBugs: [{ episodeId: BUG, createdBy: ana }] }),
    { type: "startup" },
    { effects: [openMaintenance(ana)] },
  ],
  [
    "T26 G6 approved: opens write_tests for the fix card",
    maintaining(),
    { type: "gate_decided", key: "G6", decision: "approve", taskId: FIX, actor: ana },
    { effects: [{ type: "open_item", kind: "write_tests", subjectId: FIX, createdBy: ana }] },
  ],
  [
    "startup repairs a missed T26: an approved G6 whose fix card got no write_tests item",
    maintaining({ approvedFixes: [{ taskId: FIX, createdBy: ana }] }),
    { type: "startup" },
    { effects: [{ type: "open_item", kind: "write_tests", subjectId: FIX, createdBy: ana }] },
  ],
  [
    "T27 G6 rejected: nothing more (the route wrote the Defect and the card note)",
    maintaining(),
    {
      type: "gate_decided",
      key: "G6",
      decision: "reject",
      reason: "Not a bug.",
      taskId: FIX,
      actor: ana,
    },
    { effects: [] },
  ],
);

// T28 and T29 (task 5.4): the close route starts the Curator; its item done closes the project.
const openCurator = (createdBy: Actor) =>
  ({ type: "open_item", kind: "curator", subjectId: null, createdBy }) as const;
rows.push(
  [
    "T28 the project closed: case_study, and the Curator starts",
    maintaining(),
    { type: "project_closed", actor: ana },
    { stage: "case_study", effects: [openCurator(ana)] },
  ],
  [
    "startup repairs a missed T28: closedAt is written, the stage is still maintenance",
    maintaining({ closedAt: 1 }),
    { type: "startup" },
    { stage: "case_study", effects: [openCurator(ana)] },
  ],
  [
    "T29 the curator item done: closed",
    maintaining({ stage: "case_study", closedAt: 1 }),
    { type: "item_completed", kind: "curator", outcome: "done", actor: "curator" },
    { stage: "closed", effects: [] },
  ],
  [
    "startup repairs a missed T29: a curator item is done, the stage is still case_study",
    maintaining({ stage: "case_study", closedAt: 1, curatorDone: true }),
    { type: "startup" },
    { stage: "closed", effects: [] },
  ],
  [
    "a late project_closed changes nothing once the project left maintenance",
    maintaining({ stage: "closed", closedAt: 1, curatorDone: true }),
    { type: "project_closed", actor: ana },
    { effects: [] },
  ],
  [
    "a curator item done outside case_study changes nothing",
    maintaining({ stage: "closed", closedAt: 1, curatorDone: true }),
    { type: "item_completed", kind: "curator", outcome: "done", actor: "curator" },
    { effects: [] },
  ],
  [
    "a failed curator item leaves the project in case_study",
    maintaining({ stage: "case_study", closedAt: 1 }),
    { type: "item_completed", kind: "curator", outcome: "failed", actor: "curator" },
    { effects: [] },
  ],
);

describe("machine.next", () => {
  it.each(rows)("%s", (_name, state, event, expected) => {
    expect(next(state, event)).toEqual(expected);
  });
});
