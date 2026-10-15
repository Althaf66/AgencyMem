// The stage machine (stage-machine.md): one pure function from the project state and an event to a
// new stage and the effects to run. No I/O. Transitions arrive with the tasks that need them:
// T1 and T2 (task 2.2), T3 (task 2.5), T5 to T7 (task 2.7), T8 to T10 (task 3.2), C1 and C2
// (task 3.3), T12 (task 3.4), T11, T13 and T14 (task 3.5), T15 (task 3.6), T16 (task 3.8).
import type {
  Actor,
  ChangeRequestStatus,
  DocumentStatus,
  EpochMs,
  GateKey,
  GateStatus,
  Id,
  Stage,
  WorkItemKind,
} from "@agencymem/contracts";

/** Gates that exist from project creation; each G6 is created by propose_fix. */
export const PROJECT_GATES: readonly GateKey[] = ["G1", "G2", "G3", "G5"];

export type StageState = {
  stage: Stage;
  /** Who created the Project: the actor of a repaired T1. */
  createdBy: Actor;
  /** The keys of the Gates that exist. */
  gates: GateKey[];
  /** Processed Documents with no intake item, each with the actor who uploaded it. */
  unopened: { documentId: Id; createdBy: Actor }[];
  /** Intake items open or claimed. */
  openIntake: number;
  processedDocuments: number;
  g1: GateStatus | null;
  /** intake_answer items open or claimed. */
  openIntakeAnswer: number;
  /** Answer Episodes with no intake_answer item, each with the actor who answered. */
  unopenedAnswers: { episodeId: Id; createdBy: Actor }[];
  g2: GateState | null;
  /** proposal items open or claimed. */
  openProposal: number;
  /** The newest proposal item (startup repair of T8 and T9). */
  lastProposal: { createdAt: EpochMs; doneAt: EpochMs | null } | null;
  /** Every ChangeRequest, with what C1 and C2 need. */
  changeRequests: {
    id: Id;
    text: string;
    status: ChangeRequestStatus;
    createdBy: Actor;
    /** A change_request item exists for it; one is done. */
    hasItem: boolean;
    itemDone: boolean;
    /** The Tasks and DocSections FLAGGED_BY it. */
    tasks: number;
    sections: number;
    /** An architect_revise or replan item exists for it. */
    revise: boolean;
    replan: boolean;
  }[];
  /** human_edit Episodes with no architect_revise item (startup repair of T12). */
  unopenedEdits: { episodeId: Id; text: string; createdBy: Actor }[];
  g3: GateState | null;
  /** The newest architect_revise with no subject: a G3 revision (T13 and its repair). */
  lastRevision: { createdAt: EpochMs; doneAt: EpochMs | null } | null;
  /** A planner item is done (T15 and its repair). */
  plannerDone: boolean;
  /** Build Tasks in Backlog with no write_tests item. */
  untestedCards: { taskId: Id }[];
  /** Build Tasks past Backlog and Rework (T16 and its repair). */
  readyCards: number;
};

type GateState = {
  status: GateStatus;
  reason: string | null;
  decidedAt: EpochMs | null;
  decidedBy: Actor | null;
};

export type StageEvent =
  | { type: "project_created"; actor: Actor }
  | { type: "files_uploaded"; actor: Actor; documents: { id: Id; status: DocumentStatus }[] }
  | {
      type: "item_completed";
      kind: WorkItemKind;
      outcome: "done" | "failed";
      actor: Actor;
      /** The item's subjectId: the ChangeRequest of a change_request item (C2). */
      subjectId?: Id | null;
    }
  | { type: "change_request_created"; crId: Id; actor: Actor }
  /** T16: write_tests moved a card to Ready. */
  | { type: "card_ready" }
  /** T12: route 21 before G3 wrote the human_edit Episode; `note` names the section, if any. */
  | { type: "chat"; episodeId: Id; note: string; actor: Actor }
  | { type: "question_answered"; episodeId: Id; actor: Actor }
  | {
      type: "gate_decided";
      key: GateKey;
      decision: "approve" | "reject";
      reason?: string;
      actor: Actor;
    }
  | { type: "startup" };

export type Effect =
  | { type: "create_gates"; keys: GateKey[]; createdBy: Actor }
  | {
      type: "open_item";
      kind: WorkItemKind;
      subjectId: Id | null;
      createdBy: Actor;
      /** The item's input, for example a G2 rejection reason (T9). */
      note?: string;
    }
  | { type: "reopen_gate"; key: GateKey };

/** `stage` is set only when the stage changes. */
export type StageResult = { stage?: Stage; effects: Effect[] };

const openIntake = (subjectId: Id, createdBy: Actor): Effect => ({
  type: "open_item",
  kind: "intake",
  subjectId,
  createdBy,
});

/** T3's condition: still in intake, no intake item open or claimed, at least one processed file. */
const intakeFinished = (s: StageState) =>
  s.stage === "intake" && s.openIntake === 0 && s.processedDocuments > 0;

// T3: Discovery starts. The intake agent, whose last item finished intake, opens it.
const startDiscovery: StageResult = {
  stage: "discovery",
  effects: [{ type: "open_item", kind: "discovery", subjectId: null, createdBy: "intake" }],
};

/**
 * T6 and T7's condition: in discovery, G1 approved, every answer turned into facts. An answer whose
 * item is not open yet (route 9 writes the answer, then opens its item) still counts as unfinished.
 */
const answersFinished = (s: StageState) =>
  s.stage === "discovery" &&
  s.g1 === "approved" &&
  s.openIntakeAnswer === 0 &&
  s.unopenedAnswers.length === 0;

// T6 and T7: Proposal starts, opened by whoever finished the last of the two.
const startProposal = (createdBy: Actor): StageResult => ({
  stage: "proposal",
  effects: [{ type: "open_item", kind: "proposal", subjectId: null, createdBy }],
});

// T9: Proposal revises with the rejection reason as the item's note.
const reviseProposal = (reason: string, createdBy: Actor): Effect => ({
  type: "open_item",
  kind: "proposal",
  subjectId: null,
  createdBy,
  note: reason,
});

// T10: the Architect starts; the project moves to design.
const startDesign = (createdBy: Actor): StageResult => ({
  stage: "design",
  effects: [{ type: "open_item", kind: "architect", subjectId: null, createdBy }],
});

// T14: the Planner starts; the project moves to planning.
const startPlanning = (createdBy: Actor): StageResult => ({
  stage: "planning",
  effects: [{ type: "open_item", kind: "planner", subjectId: null, createdBy }],
});

// T13: the Architect revises with the rejection reason as the item's note. No subject: a chat
// item has its Episode, a change request's item its ChangeRequest.
const reviseDesign = (reason: string, createdBy: Actor): Effect => ({
  type: "open_item",
  kind: "architect_revise",
  subjectId: null,
  createdBy,
  note: reason,
});

// T15: the Test agent writes the specs of each new card.
const writeTests = (s: StageState): Effect[] =>
  s.untestedCards.map((c) => ({
    type: "open_item",
    kind: "write_tests",
    subjectId: c.taskId,
    createdBy: "planner",
  }));

/** T13's return: G3 was rejected and the revision opened after the rejection is done. */
const g3Revised = (s: StageState) =>
  s.g3?.status === "rejected" &&
  s.lastRevision !== null &&
  s.lastRevision.doneAt !== null &&
  s.lastRevision.createdAt >= (s.g3.decidedAt ?? 0);

/** T8's condition: G2 was rejected and a proposal item made after the rejection is done. */
const revisionDone = (s: StageState) =>
  s.g2?.status === "rejected" &&
  s.openProposal === 0 &&
  s.lastProposal !== null &&
  s.lastProposal.doneAt !== null &&
  s.lastProposal.createdAt >= (s.g2.decidedAt ?? 0);

type ChangeRequestState = StageState["changeRequests"][number];

const revise = (episodeId: Id, note: string, createdBy: Actor): Effect => ({
  type: "open_item",
  kind: "architect_revise",
  subjectId: episodeId,
  createdBy,
  note,
});

/** C1: Proposal applies the change request. */
const applyChangeRequest = (crId: Id, createdBy: Actor): Effect => ({
  type: "open_item",
  kind: "change_request",
  subjectId: crId,
  createdBy,
});

/**
 * C2: an applied CR that flagged sections opens architect_revise (the CR text as its note); one
 * that flagged cards opens replan. C4: a no_change or needs_scope CR opens nothing. T30 (a flagged
 * card that was Done during e2e or launch) arrives with those stages (tasks 5.1 and 5.2).
 */
function followUps(cr: ChangeRequestState): Effect[] {
  if (cr.status !== "applied") return [];
  const effects: Effect[] = [];
  if (cr.sections > 0 && !cr.revise) {
    effects.push({
      type: "open_item",
      kind: "architect_revise",
      subjectId: cr.id,
      createdBy: "proposal",
      note: cr.text,
    });
  }
  if (cr.tasks > 0 && !cr.replan) {
    effects.push({ type: "open_item", kind: "replan", subjectId: cr.id, createdBy: "proposal" });
  }
  return effects;
}

export function next(state: StageState, event: StageEvent): StageResult {
  switch (event.type) {
    // T1: the project starts in intake (create-project.cypher) with its four gates waiting.
    case "project_created":
      return {
        effects: [{ type: "create_gates", keys: [...PROJECT_GATES], createdBy: event.actor }],
      };

    // T2: one intake item per processed Document; a no_text or failed Document opens nothing.
    // The route refuses an upload outside intake before anything is written.
    case "files_uploaded":
      return {
        effects: event.documents
          .filter((d) => d.status === "processed")
          .map((d) => openIntake(d.id, event.actor)),
      };

    // T3: complete_item on intake, when no other intake item is open or claimed.
    // T7: complete_item on intake_answer, when G1 is approved and no other one is left.
    case "item_completed":
      if (event.outcome !== "done") return { effects: [] };
      if (event.kind === "intake" && intakeFinished(state)) return startDiscovery;
      if (event.kind === "intake_answer" && answersFinished(state)) return startProposal("intake");
      if (event.kind === "change_request") {
        const cr = state.changeRequests.find((c) => c.id === event.subjectId);
        return { effects: cr ? followUps(cr) : [] };
      }
      // T8: the revision is done; G2 waits for a decision again.
      if (event.kind === "proposal" && state.g2?.status === "rejected") {
        return { effects: [{ type: "reopen_gate", key: "G2" }] };
      }
      // T13: the G3 revision is done; G3 waits for a decision again. T11 needs nothing here: the
      // gate route reads whether an architect item is still open.
      if (event.kind === "architect_revise" && g3Revised(state)) {
        return { effects: [{ type: "reopen_gate", key: "G3" }] };
      }
      if (event.kind === "planner") return { effects: writeTests(state) };
      return { effects: [] };

    // T12: the Architect revises with the chat text (and its section) as the item's note.
    case "chat":
      return { effects: [revise(event.episodeId, event.note, event.actor)] };

    // T16: the first Ready card starts the build.
    // T15 is repaired with it: a card that never got its write_tests item gets it now.
    case "card_ready":
      return state.stage === "planning"
        ? { stage: "build", effects: writeTests(state) }
        : { effects: [] };

    // C1: route 22 has written the ChangeRequest and its episode.
    case "change_request_created":
      return { effects: [applyChangeRequest(event.crId, event.actor)] };

    // T5: the answer route has written the answer; Intake turns it into facts.
    case "question_answered":
      return {
        effects: [
          {
            type: "open_item",
            kind: "intake_answer",
            subjectId: event.episodeId,
            createdBy: event.actor,
          },
        ],
      };

    // T6: G1 approved (the route has written it). Proposal starts now, or at T7 when answers are
    // still being turned into facts. Other gates arrive with their tasks.
    case "gate_decided":
      if (event.key === "G1" && event.decision === "approve" && answersFinished(state)) {
        return startProposal(event.actor);
      }
      // T9 and T10: the route checked that G2 was decidable and wrote the decision.
      if (event.key === "G2" && event.decision === "reject" && event.reason) {
        return { effects: [reviseProposal(event.reason, event.actor)] };
      }
      if (event.key === "G2" && event.decision === "approve") return startDesign(event.actor);
      // T13 and T14, the same way for G3.
      if (event.key === "G3" && event.decision === "reject" && event.reason) {
        return { effects: [reviseDesign(event.reason, event.actor)] };
      }
      if (event.key === "G3" && event.decision === "approve") return startPlanning(event.actor);
      return { effects: [] };

    // Rule 3: repair what a crash between a write and its effects left half done.
    case "startup": {
      const effects: Effect[] = [];
      const missing = PROJECT_GATES.filter((key) => !state.gates.includes(key));
      if (missing.length)
        effects.push({ type: "create_gates", keys: missing, createdBy: state.createdBy });
      // ponytail: the repaired note is the episode's text; the section name the route added is lost.
      for (const e of state.unopenedEdits) effects.push(revise(e.episodeId, e.text, e.createdBy));
      for (const cr of state.changeRequests) {
        if (!cr.hasItem) effects.push(applyChangeRequest(cr.id, cr.createdBy));
        else if (cr.itemDone) effects.push(...followUps(cr));
      }
      if (state.unopened.length && state.stage === "intake") {
        for (const d of state.unopened) effects.push(openIntake(d.documentId, d.createdBy));
      } else if (intakeFinished(state)) {
        return { stage: startDiscovery.stage, effects: [...effects, ...startDiscovery.effects] };
      } else if (state.unopenedAnswers.length && state.stage === "discovery") {
        for (const a of state.unopenedAnswers) {
          effects.push({
            type: "open_item",
            kind: "intake_answer",
            subjectId: a.episodeId,
            createdBy: a.createdBy,
          });
        }
      } else if (answersFinished(state)) {
        const proposal = startProposal("intake");
        return { stage: proposal.stage, effects: [...effects, ...proposal.effects] };
      } else if (state.stage === "proposal" && state.g2) {
        const { g2 } = state;
        const by = g2.decidedBy ?? state.createdBy;
        if (g2.status === "approved") {
          const design = startDesign(by);
          return { stage: design.stage, effects: [...effects, ...design.effects] };
        }
        if (revisionDone(state)) effects.push({ type: "reopen_gate", key: "G2" });
        else if (
          g2.status === "rejected" &&
          g2.reason &&
          state.openProposal === 0 &&
          (state.lastProposal?.createdAt ?? 0) < (g2.decidedAt ?? 0)
        ) {
          effects.push(reviseProposal(g2.reason, by));
        }
      } else if (state.stage === "design" && state.g3) {
        const { g3 } = state;
        const by = g3.decidedBy ?? state.createdBy;
        if (g3.status === "approved") {
          const planning = startPlanning(by);
          return { stage: planning.stage, effects: [...effects, ...planning.effects] };
        }
        if (g3Revised(state)) effects.push({ type: "reopen_gate", key: "G3" });
        else if (
          g3.status === "rejected" &&
          g3.reason &&
          (state.lastRevision?.createdAt ?? 0) < (g3.decidedAt ?? 0)
        ) {
          effects.push(reviseDesign(g3.reason, by));
        }
      } else if ((state.stage === "planning" || state.stage === "build") && state.plannerDone) {
        // T15 repair (also after the build started), then T16 repair.
        effects.push(...writeTests(state));
        if (state.stage === "planning" && state.readyCards > 0) return { stage: "build", effects };
      }
      return { effects };
    }
  }
}
