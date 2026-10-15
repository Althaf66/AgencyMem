// stage-machine.md section 1, rule 4: one row per transition.
import { describe, expect, it } from "vitest";
import type { Actor } from "@agencymem/contracts";
import { next, type StageEvent, type StageResult, type StageState } from "./machine";

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

describe("machine.next", () => {
  it.each(rows)("%s", (_name, state, event, expected) => {
    expect(next(state, event)).toEqual(expected);
  });
});
