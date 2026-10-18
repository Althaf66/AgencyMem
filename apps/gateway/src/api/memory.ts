// The Memory screen. GET /api/projects/:id/memory: the client's turns (files, questions, answers,
// change requests, asks and their replies) in time order, and every Fact with validFrom and
// validTo, so the screen can show what the project knew after any turn. POST /api/projects/:id/ask:
// a person's question, which the Discovery agent answers from the graph.
import express, { type Router } from "express";
import { AskBody, MemoryResponse, type MemoryTurn } from "@agencymem/contracts";
import { readQuery, type FalkorDB } from "@agencymem/graph";
import { askProject } from "@agencymem/memory";
import type { Events } from "../events/bus";
import { MISSING_ACTOR, parseBody, pathProject, personActor, sendError } from "./http";

type Row = Omit<MemoryTurn, "facts" | "ended"> & { factIds: string[]; endedIds: string[] };

export function memoryRouter(deps: { db: () => Promise<FalkorDB>; events: Events }): Router {
  const router = express.Router();

  router.get("/projects/:id/memory", async (req, res) => {
    const db = await deps.db();
    const found = await pathProject(db, req.params.id);
    if (!found.ok) return sendError(res, found.error);
    const seq = deps.events.current(found.id); // read before the snapshot (C12)
    const params = { projectId: found.id };
    const rows = await readQuery<Row>(db, found.graph, "read/conversation", params);
    const facts = await readQuery<MemoryResponse["facts"][number]>(
      db,
      found.graph,
      "read/fact-history",
      params,
    );
    const turns = rows
      .map(({ factIds, endedIds, ...t }) => ({
        ...t,
        sourceIds: t.sourceIds ?? [],
        facts: new Set(factIds).size, // a fact from two lines of one file counts once
        ended: new Set(endedIds).size,
      }))
      .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    res.json(MemoryResponse.parse({ turns, facts, seq }));
  });

  // ponytail: any stage, closed included: a question changes no project state.
  router.post("/projects/:id/ask", async (req, res) => {
    const actor = personActor(req);
    if (!actor) return sendError(res, MISSING_ACTOR);
    const body = parseBody(AskBody, req.body);
    if (!body.ok) return sendError(res, body.error);
    const db = await deps.db();
    const found = await pathProject(db, req.params.id);
    if (!found.ok) return sendError(res, found.error);
    const ctx = { db, graph: found.graph, projectId: found.id };
    const { episode, item } = await askProject(ctx, {
      text: body.data.text,
      createdBy: actor,
      now: Date.now(),
    });
    deps.events.emit(found.id, "node.written", {
      label: "WorkItem",
      id: item.id,
      version: item.version,
      summary: "ask item open",
      ids: [item.id, episode.id],
    });
    res.status(201).json({ episodeId: episode.id, workItemId: item.id });
  });

  return router;
}
