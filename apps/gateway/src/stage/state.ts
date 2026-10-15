// Reads the project state the stage machine needs: the stage from the registry, the rest from the
// client graph (read/stage-state.cypher).
import {
  Actor,
  ChangeRequestStatus,
  EpochMs,
  GateKey,
  GateStatus,
  Id,
  Project,
} from "@agencymem/contracts";
import { REGISTRY_GRAPH, readQuery, type FalkorDB } from "@agencymem/graph";
import type { StageState } from "./machine";

type Row = {
  gates: {
    key: unknown;
    status: unknown;
    reason: unknown;
    decidedAt: unknown;
    decidedBy: unknown;
  }[];
  openProposal: number;
  lastProposal: { createdAt: unknown; doneAt: unknown } | null;
  lastRevision: { createdAt: unknown; doneAt: unknown } | null;
  plannerDone: boolean;
  untestedCards: { taskId: unknown }[];
  readyCards: number;
  unopenedEdits: { episodeId: unknown; text: unknown; createdBy: unknown }[];
  changeRequests: (Omit<StageState["changeRequests"][number], "id" | "status" | "createdBy"> & {
    id: unknown;
    status: unknown;
    createdBy: unknown;
  })[];
  openIntake: number;
  processedDocuments: number;
  unopened: { documentId: unknown; createdBy: unknown }[];
  openIntakeAnswer: number;
  unopenedAnswers: { episodeId: unknown; createdBy: unknown }[];
};

/** Null for an unknown project. */
export async function readStageState(
  db: FalkorDB,
  projectId: string,
  graph: string,
): Promise<StageState | null> {
  const [row] = await readQuery<{ p: { properties: Record<string, unknown> } }>(
    db,
    REGISTRY_GRAPH,
    "read/project",
    { projectId },
  );
  if (!row) return null;
  const project = Project.parse(row.p.properties);
  const [state] = await readQuery<Row>(db, graph, "read/stage-state", { projectId });
  const gates = (state?.gates ?? []).map((g) => ({
    key: GateKey.parse(g.key),
    status: GateStatus.parse(g.status),
    reason: typeof g.reason === "string" ? g.reason : null,
    decidedAt: EpochMs.nullable().parse(g.decidedAt ?? null),
    decidedBy: Actor.nullable().parse(g.decidedBy ?? null),
  }));
  const gate = (key: GateKey) => {
    const g = gates.find((x) => x.key === key);
    return g
      ? { status: g.status, reason: g.reason, decidedAt: g.decidedAt, decidedBy: g.decidedBy }
      : null;
  };
  const times = (t: { createdAt: unknown; doneAt: unknown } | null | undefined) =>
    t
      ? {
          createdAt: EpochMs.parse(t.createdAt),
          doneAt: EpochMs.nullable().parse(t.doneAt ?? null),
        }
      : null;
  return {
    stage: project.stage,
    createdBy: project.createdBy,
    gates: gates.map((g) => g.key),
    g1: gates.find((g) => g.key === "G1")?.status ?? null,
    openIntakeAnswer: state?.openIntakeAnswer ?? 0,
    g2: gate("G2"),
    g3: gate("G3"),
    openProposal: state?.openProposal ?? 0,
    unopenedEdits: (state?.unopenedEdits ?? []).map((e) => ({
      episodeId: Id.parse(e.episodeId),
      text: String(e.text),
      createdBy: Actor.parse(e.createdBy),
    })),
    changeRequests: (state?.changeRequests ?? []).map((cr) => ({
      ...cr,
      id: Id.parse(cr.id),
      status: ChangeRequestStatus.parse(cr.status),
      createdBy: Actor.parse(cr.createdBy),
    })),
    lastProposal: times(state?.lastProposal),
    lastRevision: times(state?.lastRevision),
    plannerDone: state?.plannerDone ?? false,
    untestedCards: (state?.untestedCards ?? []).map((c) => ({ taskId: Id.parse(c.taskId) })),
    readyCards: state?.readyCards ?? 0,
    unopenedAnswers: (state?.unopenedAnswers ?? []).map((a) => ({
      episodeId: Id.parse(a.episodeId),
      createdBy: Actor.parse(a.createdBy),
    })),
    openIntake: state?.openIntake ?? 0,
    processedDocuments: state?.processedDocuments ?? 0,
    unopened: (state?.unopened ?? []).map((u) => ({
      documentId: Id.parse(u.documentId),
      createdBy: Actor.parse(u.createdBy),
    })),
  };
}
