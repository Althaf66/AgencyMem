// Route 23 of contracts.md section 8: POST /api/query, the same as the read_query tool, for the
// web client's live query panel. The project comes from X-AM-Project.
import express, { type Router } from "express";
import { QueryBody } from "@agencymem/contracts";
import { REGISTRY_GRAPH, graphFor, readQuery, type FalkorDB } from "@agencymem/graph";
import type { Events } from "../events/bus";
import { readOnly, rejectAndCount, tenancy } from "../mcp/guards";
import { runReadQuery } from "../mcp/tools/read-query";
import { parseBody, personActor, sendError } from "./http";

const TOOL = "POST /api/query";

export function queryRouter(deps: { db: () => Promise<FalkorDB>; events: Events }): Router {
  const router = express.Router();

  router.post("/query", async (req, res) => {
    const body = parseBody(QueryBody, req.body);
    if (!body.ok) return sendError(res, body.error);

    const db = await deps.db();
    const projectId = req.get("X-AM-Project");
    const at = { events: deps.events, tool: TOOL, agent: personActor(req) ?? "human:ui" };

    // Guards in order: tenancy, then read-only. A missing or unknown project has no counter to
    // add to, so those two rejections are not counted and send no event.
    const known = projectId
      ? (await readQuery(db, REGISTRY_GRAPH, "read/project", { projectId })).length > 0
      : false;
    const refused = tenancy({ projectId, known }) ?? readOnly(body.data.cypher, "ui");
    if (refused) return sendError(res, await rejectAndCount(db, projectId ?? "", refused, at));

    const result = await runReadQuery(db, await graphFor(db, projectId!), body.data);
    if (!result.ok) return sendError(res, result.error);
    res.json(result.output);
  });

  return router;
}
