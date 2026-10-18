// Route 29 of contracts.md section 8: a person closes the project with the actual hours of each
// feature (stage-machine.md T28), once Launch has written its readiness report. The actuals and
// closedAt are written, then the stage machine moves to case_study and opens the curator item.
import express, { type Router } from "express";
import { CloseProjectBody, type Rejection } from "@agencymem/contracts";
import { readQuery, type FalkorDB } from "@agencymem/graph";
import { closeProject } from "@agencymem/memory";
import type { Events } from "../events/bus";
import { reject, rejectAndCount, type GuardResult } from "../mcp/guards";
import { projectInfo } from "../project-info";
import type { Row as GateRow } from "./gates";
import { runStage } from "../stage/effects";
import { readStageState } from "../stage/state";
import { MISSING_ACTOR, parseBody, pathProject, personActor, sendError } from "./http";

const TOOL = "POST /api/projects/:id/close";

const invalid = (reason: string): Rejection => ({ code: "VALIDATION_FAILED", reason });

export function closeRouter(deps: { db: () => Promise<FalkorDB>; events: Events }): Router {
  const router = express.Router();

  // 29. POST /api/projects/:id/close: 409 outside launch or before the readiness report; 400 over a
  // failed report without override and a reason, or unless the actuals name exactly the current
  // features (decision 9).
  router.post("/projects/:id/close", async (req, res) => {
    const actor = personActor(req);
    if (!actor) return sendError(res, MISSING_ACTOR);
    const body = parseBody(CloseProjectBody, req.body);
    if (!body.ok) return sendError(res, body.error);
    const db = await deps.db();
    const found = await pathProject(db, req.params.id);
    if (!found.ok) return sendError(res, found.error);
    const at = { events: deps.events, tool: TOOL, agent: actor };
    const refuse = async (refused: GuardResult) =>
      sendError(res, await rejectAndCount(db, found.id, refused, at));

    const state = await readStageState(db, found.id, found.graph);
    if (state && state.stage !== "launch") {
      return refuse(
        reject(
          "gate",
          "WRONG_STAGE",
          state.stage === "case_study" || state.stage === "closed"
            ? "The project is closed already."
            : "A project closes after the launch checks.",
          { stage: state.stage },
        ),
      );
    }
    // The newest launch item and report (T22's old rule). A launch item T30 cancelled leaves an old
    // report behind: it no longer counts. Every read/gates row carries the same launch facts.
    const [launch] = await readQuery<GateRow>(db, found.graph, "read/gates", {
      projectId: found.id,
    });
    if (launch?.lastLaunch !== "done" || launch.reportPassed === null) {
      const checking = launch?.lastLaunch === "open" || launch?.lastLaunch === "claimed";
      return refuse(
        reject(
          "gate",
          "WRONG_STAGE",
          checking ? "Launch is still checking." : "There is no readiness report yet.",
        ),
      );
    }
    const reason = body.data.reason?.trim() || null;
    if (!launch.reportPassed && !(body.data.override && reason)) {
      return sendError(
        res,
        invalid("The readiness report failed: close with override and a reason."),
      );
    }

    const { actuals } = body.data;
    const features = await readQuery<{ id: string; key: string }>(
      db,
      found.graph,
      "read/features",
      {
        projectId: found.id,
      },
    );
    const named = new Set(actuals.map((a) => a.featureId));
    const missing = features.filter((f) => !named.has(f.id)).map((f) => f.key);
    const current = new Set(features.map((f) => f.id));
    if (named.size !== actuals.length) return sendError(res, invalid("A feature is named twice."));
    if (missing.length) {
      return sendError(res, invalid(`Actual hours are missing for ${missing.join(", ")}.`));
    }
    const extra = actuals.find((a) => !current.has(a.featureId));
    if (extra) {
      return sendError(res, invalid(`${extra.featureId} is not a current feature.`));
    }

    const ctx = { db, graph: found.graph, projectId: found.id };
    // ponytail: two concurrent closes both pass the stage read, and the loser's actuals overwrite the
    // winner's (two graphs, so no single query can hold both). The loser is refused below.
    const written = await closeProject(ctx, {
      actuals,
      overrideReason: launch.reportPassed ? null : reason,
      now: Date.now(),
    });
    if (written.features.length) {
      deps.events.emit(found.id, "node.written", {
        label: "Feature",
        id: written.features[0]!.id,
        version: written.features[0]!.version,
        summary: `Actual hours on ${written.features.length} features`,
        ids: written.features.map((f) => f.id),
      });
    }
    if (!written.closed) {
      return refuse(reject("gate", "WRONG_STAGE", "The project is closed already."));
    }
    const opened = await runStage(db, deps.events, found.id, { type: "project_closed", actor });
    const item = opened.find((o) => o.kind === "curator");
    const project = await projectInfo(db, found.id);
    if (!item || !project) {
      // The startup repair opens it (T28); the actuals and closedAt are written.
      return sendError(res, { code: "INTERNAL", reason: "The curator item did not open." });
    }
    res.json({ project, workItemId: item.id });
  });

  return router;
}
