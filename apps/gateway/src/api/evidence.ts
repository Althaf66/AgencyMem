// Evidence routes: what the agents did, for the Home feed, the Pipeline screen and the card story.
import express, { type Router } from "express";
import type { EventsResponse } from "@agencymem/contracts";
import type { FalkorDB } from "@agencymem/graph";
import type { Events } from "../events/bus";
import { pathProject, sendError } from "./http";

export function evidenceRouter(deps: { db: () => Promise<FalkorDB>; events: Events }): Router {
  const router = express.Router();

  // GET /api/projects/:id/events: the replay buffer, so a refreshed page still shows recent work.
  router.get("/projects/:id/events", async (req, res) => {
    const found = await pathProject(await deps.db(), req.params.id);
    if (!found.ok) return sendError(res, found.error);
    const body: EventsResponse = { events: deps.events.recent(found.id) };
    res.json(body);
  });

  return router;
}
