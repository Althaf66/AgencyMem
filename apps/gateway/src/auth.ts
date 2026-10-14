// Token checks. Three static tokens from config; each route group accepts only its own
// (technical design "Security for this release").
import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import type { ErrorBody } from "@agencymem/contracts";

/** Constant-time comparison, so the time taken does not leak how much of a token matched. */
export function tokenMatches(sent: string | undefined, token: string): boolean {
  if (sent === undefined) return false;
  const a = Buffer.from(sent);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

const unauthorized: ErrorBody = {
  error: { code: "UNAUTHORIZED", reason: "Missing or wrong X-AM-Token for this route." },
};

/** Lets a request through when its `X-AM-Token` header is one of `tokens`; otherwise 401. */
export function requireToken(...tokens: string[]): RequestHandler {
  return (req, res, next) => {
    const sent = req.get("X-AM-Token");
    if (tokens.some((token) => tokenMatches(sent, token))) return next();
    res.status(401).json(unauthorized);
  };
}
