// Route 22 of contracts.md section 8: a person records a change request (stage-machine.md C1).
import express, { type Router } from "express";
import { ChangeRequestBody, type Stage } from "@agencymem/contracts";
import type { FalkorDB } from "@agencymem/graph";
import { createChangeRequest } from "@agencymem/memory";
import type { Events } from "../events/bus";
import { reject, rejectAndCount } from "../mcp/guards";
import { runStage } from "../stage/effects";
import { readStageState } from "../stage/state";
import { MISSING_ACTOR, parseBody, pathProject, personActor, sendError } from "./http";

const TOOL = "POST /api/projects/:id/change-requests";
// stage-machine.md section 7: from G2 approval until the project closes.
const OPEN_STAGES: Stage[] = ["design", "planning", "build", "e2e", "launch", "maintenance"];

export function changeRequestsRouter(deps: {
  db: () => Promise<FalkorDB>;
  events: Events;
}): Router {
  const router = express.Router();

  // 22. POST /api/projects/:id/change-requests
  router.post("/projects/:id/change-requests", async (req, res) => {
    const actor = personActor(req);
    if (!actor) return sendError(res, MISSING_ACTOR);
    const body = parseBody(ChangeRequestBody, req.body);
    if (!body.ok) return sendError(res, body.error);
    const db = await deps.db();
    const found = await pathProject(db, req.params.id);
    if (!found.ok) return sendError(res, found.error);

    // ponytail: the stage is read before the write, as in the upload route; a CR that lands in the
    // moment the project closes is still applied.
    const state = await readStageState(db, found.id, found.graph);
    if (state && !OPEN_STAGES.includes(state.stage)) {
      const refused = reject(
        "gate",
        "WRONG_STAGE",
        state.stage === "case_study" || state.stage === "closed"
          ? "The project is closed; it takes no change requests."
          : "Change requests start after the proposal is approved (G2); answer questions or reject G2 instead.",
        { stage: state.stage },
      );
      const at = { events: deps.events, tool: TOOL, agent: actor };
      return sendError(res, await rejectAndCount(db, found.id, refused, at));
    }

    const ctx = { db, graph: found.graph, projectId: found.id };
    const { changeRequest, episode } = await createChangeRequest(ctx, {
      text: body.data.text,
      createdBy: actor,
      now: Date.now(),
    });
    deps.events.emit(found.id, "node.written", {
      label: "ChangeRequest",
      id: changeRequest.id,
      version: changeRequest.version,
      summary: "Change request open",
      ids: [changeRequest.id, episode.id],
    });
    const opened = await runStage(db, deps.events, found.id, {
      type: "change_request_created",
      crId: changeRequest.id,
      actor,
    });
    const item = opened.find((o) => o.kind === "change_request");
    if (!item) {
      // The startup repair opens it (C1); the CR itself is written.
      return sendError(res, { code: "INTERNAL", reason: "The change request item did not open." });
    }
    res.status(201).json({ crId: changeRequest.id, episodeId: episode.id, workItemId: item.id });
  });

  return router;
}
