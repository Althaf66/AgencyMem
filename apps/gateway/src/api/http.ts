// What the REST routes share (contracts.md section 8): bodies checked by their contracts schema,
// the X-AM-Actor header, and every failure as `{ error: Rejection }` with the status of section 6.
import type { Request, Response } from "express";
import { PersonActor, httpStatus, type ErrorBody, type Rejection } from "@agencymem/contracts";

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
