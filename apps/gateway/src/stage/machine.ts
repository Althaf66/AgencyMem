// The stage machine (stage-machine.md): one pure function from the project state and an event to a
// new stage and the effects to run. No I/O. Transitions arrive with the tasks that need them:
// T1 and T2 (task 2.2), T3 (task 2.5).
import type { Actor, DocumentStatus, GateKey, Id, Stage, WorkItemKind } from "@agencymem/contracts";

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
};

export type StageEvent =
  | { type: "project_created"; actor: Actor }
  | { type: "files_uploaded"; actor: Actor; documents: { id: Id; status: DocumentStatus }[] }
  | {
      type: "item_completed";
      kind: WorkItemKind;
      outcome: "done" | "failed";
      actor: Actor;
    }
  | { type: "startup" };

export type Effect =
  | { type: "create_gates"; keys: GateKey[]; createdBy: Actor }
  | { type: "open_item"; kind: WorkItemKind; subjectId: Id | null; createdBy: Actor };

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
    case "item_completed":
      if (event.kind === "intake" && event.outcome === "done" && intakeFinished(state)) {
        return startDiscovery;
      }
      return { effects: [] };

    // Rule 3: repair what a crash between a write and its effects left half done.
    case "startup": {
      const effects: Effect[] = [];
      const missing = PROJECT_GATES.filter((key) => !state.gates.includes(key));
      if (missing.length)
        effects.push({ type: "create_gates", keys: missing, createdBy: state.createdBy });
      if (state.unopened.length && state.stage === "intake") {
        for (const d of state.unopened) effects.push(openIntake(d.documentId, d.createdBy));
      } else if (intakeFinished(state)) {
        return { stage: startDiscovery.stage, effects: [...effects, ...startDiscovery.effects] };
      }
      return { effects };
    }
  }
}
