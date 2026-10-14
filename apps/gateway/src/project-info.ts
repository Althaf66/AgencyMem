import { Project, type ProjectInfo } from "@agencymem/contracts";
import { REGISTRY_GRAPH, clientGraphName, readQuery, type FalkorDB } from "@agencymem/graph";

/**
 * The ProjectInfo of a project (contracts.md section 5): the registry Project and its client's name,
 * plus the product and design versions from the client graph. Null for an unknown project.
 * `clarity` stays null until Discovery is done (Phase 2).
 */
export async function projectInfo(db: FalkorDB, projectId: string): Promise<ProjectInfo | null> {
  const [row] = await readQuery<{
    p: { properties: Record<string, unknown> };
    clientName: string | null;
  }>(db, REGISTRY_GRAPH, "read/project-info", { projectId });
  if (!row) return null;
  const project = Project.parse(row.p.properties);
  const [versions] = await readQuery<{ productVersion: number; designVersion: number }>(
    db,
    clientGraphName(project.clientId),
    "read/product-versions",
    { projectId },
  );
  return {
    id: project.id,
    clientId: project.clientId,
    clientName: row.clientName ?? "",
    name: project.name,
    mode: project.mode,
    stage: project.stage,
    productVersion: versions?.productVersion ?? 0,
    designVersion: versions?.designVersion ?? 0,
    clarity: null,
    closedAt: project.closedAt,
    createdAt: project.createdAt,
  };
}
