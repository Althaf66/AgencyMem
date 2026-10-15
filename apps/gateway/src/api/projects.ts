// Routes 1, 2 and 3 of contracts.md section 8: create a project, list projects, read one project.
import express, { type Router } from "express";
import { CreateProjectBody, Id } from "@agencymem/contracts";
import { REGISTRY_GRAPH, readQuery, type FalkorDB } from "@agencymem/graph";
import { createProject } from "@agencymem/memory";
import type { Events } from "../events/bus";
import { projectInfo } from "../project-info";
import { MISSING_ACTOR, parseBody, personActor, sendError } from "./http";

export function projectsRouter(deps: { db: () => Promise<FalkorDB>; events: Events }): Router {
  const router = express.Router();

  // 1. POST /api/projects: writes Client (found by name, or new) and Project to the registry, and
  // creates the client graph's indexes, so the project's graph is usable at once.
  router.post("/projects", async (req, res) => {
    const actor = personActor(req);
    if (!actor) return sendError(res, MISSING_ACTOR);
    const body = parseBody(CreateProjectBody, req.body);
    if (!body.ok) return sendError(res, body.error);

    const db = await deps.db();
    const { project } = await createProject(db, {
      clientName: body.data.clientName,
      projectName: body.data.projectName,
      mode: body.data.mode,
      createdBy: actor,
      now: Date.now(),
    });
    deps.events.emit(project.id, "node.written", {
      label: "Project",
      id: project.id,
      version: project.version,
      summary: `Project ${project.name} created`,
    });
    res.status(201).json({ project: await projectInfo(db, project.id) });
  });

  // 2. GET /api/projects: every project, oldest first.
  router.get("/projects", async (_req, res) => {
    const db = await deps.db();
    const rows = await readQuery<{ id: string }>(db, REGISTRY_GRAPH, "read/projects", {});
    const projects = await Promise.all(rows.map((row) => projectInfo(db, row.id)));
    res.json({ projects: projects.filter((p) => p !== null) });
  });

  // 3. GET /api/projects/:id (snapshot): the project and the seq the snapshot reflects (C12).
  router.get("/projects/:id", async (req, res) => {
    const id = Id.safeParse(req.params.id);
    if (!id.success) {
      return sendError(res, { code: "VALIDATION_FAILED", reason: "The project id is not an id." });
    }
    const db = await deps.db();
    const exists = await readQuery(db, REGISTRY_GRAPH, "read/project", { projectId: id.data });
    if (exists.length === 0) {
      return sendError(res, { code: "NOT_FOUND", reason: `Unknown project ${id.data}.` });
    }
    // The seq is read before the snapshot: an event that lands in between is then both in the
    // snapshot and replayed, never lost (the client ignores seq <= its snapshot's seq).
    const seq = deps.events.current(id.data);
    const project = await projectInfo(db, id.data);
    if (!project)
      return sendError(res, { code: "NOT_FOUND", reason: `Unknown project ${id.data}.` });
    res.json({ project, seq });
  });

  return router;
}
