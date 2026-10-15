import { Project, clarityBand, type ProjectInfo } from "@agencymem/contracts";
import { REGISTRY_GRAPH, clientGraphName, readQuery, type FalkorDB } from "@agencymem/graph";

/**
 * The ProjectInfo of a project (contracts.md section 5): the registry Project and its client's name,
 * plus the product and design versions from the client graph. Null for an unknown project.
 * `clarity` stays null until a discovery item is done; then density is the contradiction and
 * unclear questions per 1,000 words of the processed documents (computed here, not stored).
 */
export async function projectInfo(db: FalkorDB, projectId: string): Promise<ProjectInfo | null> {
  const [row] = await readQuery<{
    p: { properties: Record<string, unknown> };
    clientName: string | null;
  }>(db, REGISTRY_GRAPH, "read/project-info", { projectId });
  if (!row) return null;
  const project = Project.parse(row.p.properties);
  const graph = clientGraphName(project.clientId);
  const [versions] = await readQuery<{ productVersion: number; designVersion: number }>(
    db,
    graph,
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
    clarity: await clarity(db, graph, projectId),
    closedAt: project.closedAt,
    createdAt: project.createdAt,
  };
}

async function clarity(
  db: FalkorDB,
  graph: string,
  projectId: string,
): Promise<ProjectInfo["clarity"]> {
  const [row] = await readQuery<{ done: number; flagged: number; words: number | null }>(
    db,
    graph,
    "read/clarity",
    { projectId },
  );
  if (!row || row.done === 0 || !row.words) return null;
  const density = (row.flagged * 1000) / row.words;
  return { density, band: clarityBand(density) };
}
