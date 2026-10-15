// What the REST routes share (contracts.md section 8): bodies checked by their contracts schema,
// the X-AM-Actor header, and every failure as `{ error: Rejection }` with the status of section 6.
import type { Request, Response } from "express";
import {
  Id,
  PersonActor,
  httpStatus,
  type Actor,
  type ErrorBody,
  type Rejection,
} from "@agencymem/contracts";
import {
  REGISTRY_GRAPH,
  UnknownProjectError,
  graphFor,
  readQuery,
  type FalkorDB,
} from "@agencymem/graph";
import type { Events } from "../events/bus";
import { rejectAndCount, tenancy } from "../mcp/guards";

/** The part of a zod schema these helpers use. */
type Schema<T> = {
  safeParse(
    input: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
};

export function sendError(res: Response, error: Rejection): void {
  const body: ErrorBody = { error };
  res.status(httpStatus(error)).json(body);
}

/** Parses a body with its contracts schema; a failure is VALIDATION_FAILED with the issues. */
export function parseBody<T>(
  schema: Schema<T>,
  body: unknown,
): { ok: true; data: T } | { ok: false; error: Rejection } {
  const parsed = schema.safeParse(body ?? {});
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    error: {
      code: "VALIDATION_FAILED",
      reason: "The request body does not match the contract.",
      details: {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.map(String).join("."),
          message: i.message,
        })),
      },
    },
  };
}

/** The person behind a request: X-AM-Actor (`human:<name>` or `persona:<projectId>`), or null. */
export function personActor(req: Request): PersonActor | null {
  const parsed = PersonActor.safeParse(req.get("X-AM-Actor"));
  return parsed.success ? parsed.data : null;
}

export const MISSING_ACTOR: Rejection = {
  code: "VALIDATION_FAILED",
  reason: "A write needs X-AM-Actor: human:<name> or persona:<projectId>.",
};

/** The project of a /projects/:id path and its graph, or the rejection to send (400 or 404). */
export async function pathProject(
  db: FalkorDB,
  raw: string | undefined,
): Promise<{ ok: true; id: string; graph: string } | { ok: false; error: Rejection }> {
  const id = Id.safeParse(raw);
  if (!id.success) {
    return {
      ok: false,
      error: { code: "VALIDATION_FAILED", reason: "The project id is not an id." },
    };
  }
  try {
    return { ok: true, id: id.data, graph: await graphFor(db, id.data) };
  } catch (e) {
    if (!(e instanceof UnknownProjectError)) throw e;
    return { ok: false, error: { code: "NOT_FOUND", reason: `Unknown project ${id.data}.` } };
  }
}

/**
 * For a route whose path has no project id (contracts.md section 8): the X-AM-Project project, its
 * graph, and node `:id` with `label` in it, or the rejection to send. Tenancy runs here: a missing or
 * unknown project is not counted (no project to count on); another project's node is counted.
 */
export async function headerNode(
  db: FalkorDB,
  req: Request,
  label: string,
  at: { events: Events; tool: string; agent: Actor },
): Promise<
  | { ok: true; projectId: string; graph: string; props: Record<string, unknown> }
  | { ok: false; error: Rejection }
> {
  const projectId = req.get("X-AM-Project");
  const known = projectId
    ? (await readQuery(db, REGISTRY_GRAPH, "read/project", { projectId })).length > 0
    : false;
  const missing = tenancy({ projectId, known });
  if (missing) return { ok: false, error: await rejectAndCount(db, "", missing, at) };

  const id = Id.safeParse(req.params.id);
  if (!id.success) {
    return {
      ok: false,
      error: { code: "VALIDATION_FAILED", reason: `The ${label} id is not an id.` },
    };
  }
  const graph = await graphFor(db, projectId!);
  const [row] = await readQuery<{ n: { properties: Record<string, unknown> }; label: string }>(
    db,
    graph,
    "read/node",
    { id: id.data },
  );
  if (!row || row.label !== label) {
    return { ok: false, error: { code: "NOT_FOUND", reason: `Unknown ${label} ${id.data}.` } };
  }
  const foreign = tenancy({
    projectId,
    known,
    nodes: [{ id: id.data, projectId: String(row.n.properties.projectId) }],
  });
  if (foreign) return { ok: false, error: await rejectAndCount(db, projectId!, foreign, at) };
  return { ok: true, projectId: projectId!, graph, props: row.n.properties };
}
