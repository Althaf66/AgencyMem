// Routes 24 and 25 of contracts.md section 8: the health panel's numbers, all read from the graph.
// Counts come from read/case-metrics (approved decision 15), coverage from read/progress (as the
// progress header), rejection counters and backtraceMs from the registry Project, tokens and cost
// from the Run nodes by agent and model, priced from the meter's table. Project names come from the registry, so the agency graph stays anonymous.
import express, { type Router } from "express";
import { AgencyMetrics, FeatureKind, PRICES, ProjectMetrics, costOf } from "@agencymem/contracts";
import {
  AGENCY_GRAPH,
  REGISTRY_GRAPH,
  UnknownProjectError,
  graphFor,
  readQuery,
  type FalkorDB,
} from "@agencymem/graph";
import type { Events } from "../events/bus";
import { readCase } from "../metrics";
import { projectInfo } from "../project-info";
import { pathProject, sendError } from "./http";

type Lesson = AgencyMetrics["lessons"][number];
type Counters = {
  rejectedWrites?: number;
  rejectedClaims?: number;
  rejectedCompletions?: number;
  rejectedQueries?: number;
  backtraceMs?: number;
};

const perCR = (reopened: number, crs: number) => (crs ? reopened / crs : null);

export function metricsRouter(deps: { db: () => Promise<FalkorDB>; events: Events }): Router {
  const router = express.Router();

  // 24. GET /api/projects/:id/metrics (snapshot)
  router.get("/projects/:id/metrics", async (req, res) => {
    const db = await deps.db();
    const found = await pathProject(db, req.params.id);
    if (!found.ok) return sendError(res, found.error);
    const seq = deps.events.current(found.id); // read before the snapshot (C12)
    const params = { projectId: found.id };
    const m = await readCase(db, found.graph, found.id);
    const [project] = await readQuery<{ p: { properties: Counters } }>(
      db,
      REGISTRY_GRAPH,
      "read/project-info",
      params,
    );
    const p = project!.p.properties;
    const [progress] = await readQuery<{ total: number; covered: number }>(
      db,
      found.graph,
      "read/progress",
      params,
    );
    type Group = {
      agent: string;
      model: string;
      runs: number;
      tokensIn: number;
      tokensOut: number;
      cost: number;
    };
    const groups = await readQuery<Group>(db, found.graph, "read/run-costs", params);
    // Priced from the table now, so runs recorded before a model had a price are counted too.
    const models = groups.map((g) => ({
      ...g,
      cost: costOf(PRICES, g.model, g.tokensIn, g.tokensOut) ?? g.cost,
      price: PRICES[g.model] ?? null,
    }));
    const sum = (key: "tokensIn" | "tokensOut" | "cost") => models.reduce((n, m) => n + m[key], 0);
    res.json(
      ProjectMetrics.parse({
        estimateError: m.estimateError,
        questions: m.questions,
        contradictions: m.contradictions,
        changeRequests: m.changeRequests,
        cardsReopened: m.cardsReopened,
        cardsReopenedPerCR: perCR(m.cardsReopened, m.changeRequests),
        rejected: {
          writes: p.rejectedWrites ?? 0,
          claims: p.rejectedClaims ?? 0,
          completions: p.rejectedCompletions ?? 0,
          queries: p.rejectedQueries ?? 0,
        },
        coverage: { covered: progress?.covered ?? 0, total: progress?.total ?? 0 },
        tokensIn: sum("tokensIn"),
        tokensOut: sum("tokensOut"),
        cost: sum("cost"),
        models,
        backtraceMs: p.backtraceMs ?? null,
        seq,
      }),
    );
  });

  // 25. GET /api/agency/metrics: every project in run order, and every Lesson.
  // ponytail: one set of reads per project; read the stored CaseStudy metrics if projects grow many.
  router.get("/agency/metrics", async (_req, res) => {
    const db = await deps.db();
    const lessons = await readQuery<Lesson>(db, AGENCY_GRAPH, "read/similar-lessons", {
      featureKinds: FeatureKind.options,
    });
    const byId = new Map(lessons.map((l) => [l.id, l]));
    const ids = await readQuery<{ id: string }>(db, REGISTRY_GRAPH, "read/projects", {});
    const projects = [];
    for (const [i, { id }] of ids.entries()) {
      // A project removed since the list was read (test cleanup) is left out.
      const graph = await graphFor(db, id).catch((e: unknown) => {
        if (e instanceof UnknownProjectError) return null;
        throw e;
      });
      const info = graph && (await projectInfo(db, id));
      if (!graph || !info) continue;
      const m = await readCase(db, graph, id);
      const features = await readQuery<{ estimate: { lessonIds: string[] | null } }>(
        db,
        graph,
        "read/features",
        { projectId: id },
      );
      const used = [...new Set(features.flatMap((f) => f.estimate.lessonIds ?? []))];
      projects.push({
        projectId: id,
        name: info.name,
        order: i + 1,
        closedAt: info.closedAt,
        clarityBand: info.clarity?.band ?? null,
        estimateError: m.estimateError,
        questions: m.questions,
        cardsReopenedPerCR: perCR(m.cardsReopened, m.changeRequests),
        lessonsUsed: used.length,
        lessons: used.flatMap((lessonId) => {
          const l = byId.get(lessonId);
          return l ? [{ id: l.id, featureKind: l.featureKind, clarityBand: l.clarityBand }] : [];
        }),
      });
    }
    res.json(
      AgencyMetrics.parse({
        projects,
        lessons: lessons.map(({ id, featureKind, clarityBand, ratio, n }) => ({
          id,
          featureKind,
          clarityBand,
          ratio,
          n,
        })),
      }),
    );
  });

  return router;
}
