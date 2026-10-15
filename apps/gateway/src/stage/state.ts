// Reads the project state the stage machine needs: the stage from the registry, the rest from the
// client graph (read/stage-state.cypher).
import { Actor, GateKey, GateStatus, Id, Project } from "@agencymem/contracts";
import { REGISTRY_GRAPH, readQuery, type FalkorDB } from "@agencymem/graph";
import type { StageState } from "./machine";

type Row = {
  gates: { key: unknown; status: unknown }[];
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
  }));
  return {
    stage: project.stage,
    createdBy: project.createdBy,
    gates: gates.map((g) => g.key),
    g1: gates.find((g) => g.key === "G1")?.status ?? null,
    openIntakeAnswer: state?.openIntakeAnswer ?? 0,
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
