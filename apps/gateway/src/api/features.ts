// Route 26 of contracts.md section 8: the current Features with their estimates, each estimate
// joined in the app with the agency Lessons it used (packages/graph joins.ts).
import express, { type Router } from "express";
import { FeatureKind, FeatureView } from "@agencymem/contracts";
import { AGENCY_GRAPH, joinLessons, readQuery, type FalkorDB } from "@agencymem/graph";
import type { Events } from "../events/bus";
import { pathProject, sendError } from "./http";

type Row = Omit<FeatureView, "estimate"> & {
  estimate: Omit<FeatureView["estimate"], "lessons"> & { lessonIds: string[] };
};

export function featuresRouter(deps: { db: () => Promise<FalkorDB>; events: Events }): Router {
  const router = express.Router();

  // 26. GET /api/projects/:id/features (snapshot)
  router.get("/projects/:id/features", async (req, res) => {
    const db = await deps.db();
    const found = await pathProject(db, req.params.id);
    if (!found.ok) return sendError(res, found.error);
    const seq = deps.events.current(found.id); // read before the snapshot (C12)
    const rows = await readQuery<Row>(db, found.graph, "read/features", { projectId: found.id });
    const lessons = await readQuery<FeatureView["estimate"]["lessons"][number]>(
      db,
      AGENCY_GRAPH,
      "read/similar-lessons",
      { featureKinds: FeatureKind.options },
    );
    const features = joinLessons(rows, lessons).map((f) => FeatureView.parse(f));
    res.json({ features, seq });
  });

  return router;
}
