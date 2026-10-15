import type { Response } from "express";

/** The one error shape (sample-app.md section 7): { error: { code, message, field? } }. */
export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  field?: string,
): void {
  res.status(status).json({ error: { code, message, ...(field ? { field } : {}) } });
}
