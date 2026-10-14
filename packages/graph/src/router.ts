// The router is the only code that turns a project id into a graph name.
import type { FalkorDB } from "falkordb";
import { readQuery } from "./queries";

export const REGISTRY_GRAPH = "registry";
export const AGENCY_GRAPH = "agency";

export class UnknownProjectError extends Error {
  constructor(readonly projectId: string) {
    super(`Unknown project ${projectId}`);
    this.name = "UnknownProjectError";
  }
}

export const clientGraphName = (clientId: string): string => `client_${clientId}`;

/** The client graph of a project. An unknown project id throws; there is no default graph. */
export async function graphFor(db: FalkorDB, projectId: string): Promise<string> {
  const rows = await readQuery<{ clientId: string }>(db, REGISTRY_GRAPH, "read/project-graph", {
    projectId,
  });
  const row = rows[0];
  if (!row?.clientId) throw new UnknownProjectError(projectId); // never client_null
  return clientGraphName(row.clientId);
}
