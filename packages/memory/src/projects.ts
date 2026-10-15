import {
  Client,
  Project,
  text,
  type Mode,
  type PersonActor,
  type RejectionCounter,
  type Stage,
} from "@agencymem/contracts";
import { REGISTRY_GRAPH, clientGraphName, type FalkorDB } from "@agencymem/graph";
import { writeQuery } from "@agencymem/graph/write";
import { ulid } from "ulid";
import { applySchema } from "./schema";

type Row = {
  c: { properties: Record<string, unknown> };
  p: { properties: Record<string, unknown> };
};

/** Adds 1 to one rejection counter of the Project. Returns the new value, or null for no project. */
export async function countRejection(
  db: FalkorDB,
  projectId: string,
  counter: RejectionCounter,
): Promise<number | null> {
  const rows = await writeQuery<{ value: number }>(db, REGISTRY_GRAPH, "write/count-rejection", {
    projectId,
    counter,
  });
  return rows[0]?.value ?? null;
}

/**
 * Writes a Client (found by name, or new) and a Project to the registry, then creates the client
 * graph's indexes, so the project's graph is usable at once.
 */
export async function createProject(
  db: FalkorDB,
  input: {
    clientName: string;
    projectName: string;
    mode: Mode;
    createdBy: PersonActor;
    now: number;
  },
): Promise<{ client: Client; project: Project }> {
  // Check before writing, so a bad name never reaches the registry (contracts: name ≤80).
  const clientName = text(80).min(1).parse(input.clientName);
  const projectName = text(80).min(1).parse(input.projectName);
  const rows = await writeQuery<Row>(db, REGISTRY_GRAPH, "write/create-project", {
    clientId: ulid(),
    projectId: ulid(),
    clientName,
    projectName,
    mode: input.mode,
    createdBy: input.createdBy,
    now: input.now,
  });
  const row = rows[0];
  if (!row) throw new Error("create-project returned no row");
  const client = Client.parse(row.c.properties);
  const project = Project.parse(row.p.properties);
  await applySchema(db, clientGraphName(client.id), "client");
  return { client, project };
}

/**
 * Moves a Project from stage `from` to stage `to`. False when the Project is not in `from` (any
 * more), so a repeated effect changes nothing (stage-machine.md section 1, rule 2).
 */
export async function setStage(
  db: FalkorDB,
  projectId: string,
  from: Stage,
  to: Stage,
): Promise<boolean> {
  const rows = await writeQuery(db, REGISTRY_GRAPH, "write/set-stage", { projectId, from, to });
  return rows.length > 0;
}
