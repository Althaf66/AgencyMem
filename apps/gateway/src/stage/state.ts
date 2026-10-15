// Reads the project state the stage machine needs: the stage from the registry, the rest from the
// client graph (read/stage-state.cypher).
import { Actor, GateKey, Id, Project } from "@agencymem/contracts";
import { REGISTRY_GRAPH, readQuery, type FalkorDB } from "@agencymem/graph";
import type { StageState } from "./machine";

type Row = {
  gates: unknown[];
  openIntake: number;
  processedDocuments: number;
  unopened: { documentId: unknown; createdBy: unknown }[];
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
  return {
    stage: project.stage,
    createdBy: project.createdBy,
    gates: GateKey.array().parse(state?.gates ?? []),
    openIntake: state?.openIntake ?? 0,
    processedDocuments: state?.processedDocuments ?? 0,
    unopened: (state?.unopened ?? []).map((u) => ({
      documentId: Id.parse(u.documentId),
      createdBy: Actor.parse(u.createdBy),
    })),
  };
}
