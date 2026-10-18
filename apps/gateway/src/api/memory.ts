// GET /api/projects/:id/memory: the Memory screen. The client's turns (files, questions, answers,
// change requests) in time order, and every Fact with validFrom and validTo, so the screen can show
// what the project knew after any turn.
import express, { type Router } from "express";
import { MemoryResponse, type MemoryTurn } from "@agencymem/contracts";
import { readQuery, type FalkorDB } from "@agencymem/graph";
import type { Events } from "../events/bus";
import { pathProject, sendError } from "./http";

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
        facts: new Set(factIds).size, // a fact from two lines of one file counts once
        ended: new Set(endedIds).size,
      }))
      .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    res.json(MemoryResponse.parse({ turns, facts, seq }));
  });

  return router;
}
