// POST /api/test/reset (sample-app.md section 6): only when NODE_ENV=test. Resets the database to
// the migrations and the seed, and sets the clock to `now`.
import { Router } from "express";
import { setTestNow } from "../clock.ts";
import { reset } from "../db.ts";
import { sendError } from "../errors.ts";

export const testRoutes = Router();

testRoutes.post("/test/reset", (req, res) => {
  const at = (req.body as { now?: unknown } | undefined)?.now;
  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) {
    return sendError(res, 400, "VALIDATION_FAILED", "now must be an ISO 8601 time.", "now");
  }
  reset();
  setTestNow(at);
  res.json({ ok: true, now: at });
});
