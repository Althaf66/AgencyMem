import { Router } from "express";
import { now } from "../clock.ts";
import { seed } from "../db.ts";

export const health = Router();

health.get("/health", (_req, res) => {
  res.json({ ok: true });
});

health.get("/now", (_req, res) => {
  res.json({ now: now().toISOString() });
});

health.get("/clinic", (_req, res) => {
  res.json(seed().clinic);
});
