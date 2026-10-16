// Route 28 of contracts.md section 8: a person reports a bug after the deploy (stage-machine.md
// T24). The bug_report Episode is written, then the stage machine opens the maintenance item.
import express, { type Router } from "express";
import { BugReportBody } from "@agencymem/contracts";
import type { FalkorDB } from "@agencymem/graph";
import { writeBugReport } from "@agencymem/memory";
import type { Events } from "../events/bus";
import { reject, rejectAndCount } from "../mcp/guards";
import { runStage } from "../stage/effects";
import { readStageState } from "../stage/state";
import { MISSING_ACTOR, parseBody, pathProject, personActor, sendError } from "./http";

const TOOL = "POST /api/projects/:id/bug-reports";

export function bugReportsRouter(deps: { db: () => Promise<FalkorDB>; events: Events }): Router {
  const router = express.Router();

  // 28. POST /api/projects/:id/bug-reports: 409 before G5 is approved.
  router.post("/projects/:id/bug-reports", async (req, res) => {
    const actor = personActor(req);
    if (!actor) return sendError(res, MISSING_ACTOR);
    const body = parseBody(BugReportBody, req.body);
    if (!body.ok) return sendError(res, body.error);
    const db = await deps.db();
    const found = await pathProject(db, req.params.id);
    if (!found.ok) return sendError(res, found.error);

    // ponytail: the stage is read before the write, as in route 22.
    const state = await readStageState(db, found.id, found.graph);
    if (state && state.stage !== "maintenance") {
      const refused = reject(
        "gate",
        "WRONG_STAGE",
        state.stage === "case_study" || state.stage === "closed"
          ? "The project is closed; it takes no bug reports."
          : "Bug reports start after the deploy (G5).",
        { stage: state.stage },
      );
      const at = { events: deps.events, tool: TOOL, agent: actor };
      return sendError(res, await rejectAndCount(db, found.id, refused, at));
    }

    const ctx = { db, graph: found.graph, projectId: found.id };
    const episode = await writeBugReport(ctx, {
      text: body.data.text,
      createdBy: actor,
      now: Date.now(),
    });
    deps.events.emit(found.id, "node.written", {
      label: "Episode",
      id: episode.id,
      version: episode.version,
      summary: "Bug report",
    });
    const opened = await runStage(db, deps.events, found.id, {
      type: "bug_reported",
      episodeId: episode.id,
      actor,
    });
    const item = opened.find((o) => o.kind === "maintenance");
    if (!item) {
      // The startup repair opens it (T24); the report itself is written.
      return sendError(res, { code: "INTERNAL", reason: "The maintenance item did not open." });
    }
    res.status(201).json({ episodeId: episode.id, workItemId: item.id });
  });

  return router;
}
