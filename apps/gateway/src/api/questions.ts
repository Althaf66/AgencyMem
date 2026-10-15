// Route 8 of contracts.md section 8: GET /api/projects/:id/questions, the questionnaire snapshot.
// The answer route (9) arrives in task 2.7.
import express, { type Router } from "express";
import { QuestionView } from "@agencymem/contracts";
import { readQuery, type FalkorDB } from "@agencymem/graph";
import type { Events } from "../events/bus";
import { pathProject, sendError } from "./http";

type Props = Record<string, unknown>;
type Row = {
  q: { properties: Props };
  a: { properties: Props };
  c: { properties: Props } | null;
  sources: QuestionView["sources"];
};

function toView({ q, a, c, sources }: Row): QuestionView {
  return QuestionView.parse({
    id: q.properties.id,
    kind: q.properties.kind,
    text: q.properties.text,
    recommended: q.properties.recommended,
    reasoning: q.properties.reasoning,
    approach: q.properties.approach,
    status: q.properties.status,
    version: q.properties.version,
    assumption: { id: a.properties.id, text: a.properties.text, status: a.properties.status },
    contradiction: c
      ? { id: c.properties.id, summary: c.properties.summary, status: c.properties.status }
      : null,
    sources,
    answer: null, // answers arrive with route 9 (task 2.7)
  });
}

export function questionsRouter(deps: { db: () => Promise<FalkorDB>; events: Events }): Router {
  const router = express.Router();

  // 8. GET /api/projects/:id/questions (snapshot)
  router.get("/projects/:id/questions", async (req, res) => {
    const db = await deps.db();
    const found = await pathProject(db, req.params.id);
    if (!found.ok) return sendError(res, found.error);
    const seq = deps.events.current(found.id); // read before the snapshot (C12)
    const rows = await readQuery<Row>(db, found.graph, "read/questions", { projectId: found.id });
    res.json({ questions: rows.map(toView), seq });
  });

  return router;
}
