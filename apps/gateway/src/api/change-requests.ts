// Route 22 of contracts.md section 8: a person records a change request (stage-machine.md C1).
import express, { type Router } from "express";
import { ChangeRequestBody, type Actor, type Rejection, type Stage } from "@agencymem/contracts";
import type { FalkorDB } from "@agencymem/graph";
import { createChangeRequest } from "@agencymem/memory";
import type { Events } from "../events/bus";
import { reject, rejectAndCount } from "../mcp/guards";
import { runStage } from "../stage/effects";
import { readStageState } from "../stage/state";
import { MISSING_ACTOR, parseBody, pathProject, personActor, sendError } from "./http";

const TOOL = "POST /api/projects/:id/change-requests";
// stage-machine.md section 7: from G2 approval until the project closes.
export const OPEN_STAGES: Stage[] = ["design", "planning", "build", "e2e", "launch"];

/**
 * C1: writes the ChangeRequest FROM its change_request Episode and runs the stage machine, which
 * opens the change_request item. Routes 21 (after G3) and 22 share it; the caller checked the stage.
 */
export async function openChangeRequest(
  db: FalkorDB,
  events: Events,
  project: { id: string; graph: string },
  text: string,
  actor: Actor,
): Promise<
  | { ok: true; output: { crId: string; crKey: string; episodeId: string; workItemId: string } }
  | { ok: false; error: Rejection }
> {
  const ctx = { db, graph: project.graph, projectId: project.id };
  const { changeRequest, episode } = await createChangeRequest(ctx, {
    text,
    createdBy: actor,
    now: Date.now(),
  });
  events.emit(project.id, "node.written", {
    label: "ChangeRequest",
    id: changeRequest.id,
    version: changeRequest.version,
    summary: `${changeRequest.key} open`,
    ids: [changeRequest.id, episode.id],
  });
  const opened = await runStage(db, events, project.id, {
    type: "change_request_created",
    crId: changeRequest.id,
    actor,
  });
  const item = opened.find((o) => o.kind === "change_request");
  if (!item) {
    // The startup repair opens it (C1); the CR itself is written.
    return {
      ok: false,
      error: { code: "INTERNAL", reason: "The change request item did not open." },
    };
  }
  return {
    ok: true,
    output: {
      crId: changeRequest.id,
      crKey: changeRequest.key,
      episodeId: episode.id,
      workItemId: item.id,
    },
  };
}

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

    const opened = await openChangeRequest(db, deps.events, found, body.data.text, actor);
    if (!opened.ok) return sendError(res, opened.error);
    res.status(201).json(opened.output);
  });

  return router;
}
