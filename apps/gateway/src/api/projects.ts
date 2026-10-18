// Routes 1, 2 and 3 of contracts.md section 8: create a project, list projects, read one project;
// and delete one with everything it wrote.
import { rm } from "node:fs/promises";
import { join } from "node:path";
import express, { type RequestHandler, type Router } from "express";
import { CreateProjectBody, DeleteProjectResponse, Id } from "@agencymem/contracts";
import { REGISTRY_GRAPH, readQuery, type FalkorDB } from "@agencymem/graph";
import { createProject, deleteProject } from "@agencymem/memory";
import type { Events } from "../events/bus";
import type { Previews } from "../preview";
import { projectInfo } from "../project-info";
import { runStage } from "../stage/effects";
import { projectDirOf } from "./evidence";
import { MISSING_ACTOR, parseBody, pathProject, personActor, sendError } from "./http";

/**
 * 2. GET /api/projects: every project, oldest first. main.ts mounts it for the UI and the agent
 * tokens, so the runner can find the projects it works on (task 2.4 decision).
 */
export function listProjects(deps: { db: () => Promise<FalkorDB> }): RequestHandler {
  return async (_req, res) => {
    const db = await deps.db();
    const rows = await readQuery<{ id: string }>(db, REGISTRY_GRAPH, "read/projects", {});
    const projects = await Promise.all(rows.map((row) => projectInfo(db, row.id)));
    res.json({ projects: projects.filter((p) => p !== null) });
  };
}

export function projectsRouter(deps: {
  db: () => Promise<FalkorDB>;
  events: Events;
  uploadsDir: string;
  workspacesDir: string;
  previews: Previews;
}): Router {
  const router = express.Router();

  // 1. POST /api/projects: writes Client (found by name, or new) and Project to the registry, and
  // creates the client graph's indexes, so the project's graph is usable at once. Then T1 creates
  // the project's gates.
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
    await runStage(db, deps.events, project.id, { type: "project_created", actor }); // T1: the gates
    res.status(201).json({ project: await projectInfo(db, project.id) });
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

  // DELETE /api/projects/:id: from any stage. The graphs first (memory deleteProject), then the
  // uploads and the workspace (repo and worktrees). A running agent's next call gets NOT_FOUND.
  router.delete("/projects/:id", async (req, res) => {
    const actor = personActor(req);
    if (!actor) return sendError(res, MISSING_ACTOR);
    const db = await deps.db();
    const found = await pathProject(db, req.params.id);
    if (!found.ok) return sendError(res, found.error);
    deps.previews.stop(found.id);
    await deleteProject(db, { projectId: found.id, graph: found.graph });
    // The graph is gone already, so a folder that will not go (a Windows file lock while OpenCode
    // runs in a worktree) is only logged; delete it by hand once nothing holds it.
    for (const dir of [
      join(deps.uploadsDir, found.id),
      projectDirOf(deps.workspacesDir, found.id),
    ]) {
      await rm(dir, { recursive: true, force: true }).catch((e: unknown) =>
        console.warn(`gateway: could not delete ${dir}: ${e instanceof Error ? e.message : e}`),
      );
    }
    res.json(DeleteProjectResponse.parse({ deleted: found.id }));
  });

  return router;
}
