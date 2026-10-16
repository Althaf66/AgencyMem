// The git hook route (contracts.md section 9): POST /hooks/commit with the hook token. The
// post-commit hook of every project repository posts each commit here. One query records it,
// links it to its card and runs T17 (stage-machine.md); the events go out after it commits.
import express, { type Router } from "express";
import { CommitHookBody, CommitHookResponse } from "@agencymem/contracts";
import type { FalkorDB } from "@agencymem/graph";
import { recordCommit } from "@agencymem/memory";
import type { Events } from "../events/bus";
import { parseBody, pathProject, sendError } from "./http";

export function hooksRouter(deps: { db: () => Promise<FalkorDB>; events: Events }): Router {
  const router = express.Router();

  router.post("/commit", async (req, res) => {
    const body = parseBody(CommitHookBody, req.body);
    if (!body.ok) return sendError(res, body.error);
    const db = await deps.db();
    const project = await pathProject(db, body.data.projectId);
    if (!project.ok) return sendError(res, project.error);

    const { projectId, ...commit } = body.data;
    const recorded = await recordCommit(
      { db, graph: project.graph, projectId },
      { ...commit, now: Date.now() },
    );
    const { codeChange, task, workItemId } = recorded;

    // The same sha again changes nothing, so it sends nothing.
    if (recorded.created) {
      deps.events.emit(projectId, "node.written", {
        label: "CodeChange",
        id: codeChange.id,
        version: codeChange.version,
        summary: `${codeChange.sha.slice(0, 7)} on ${codeChange.branch}`.slice(0, 120),
      });
      if (task && task.from !== task.to) {
        deps.events.emit(projectId, "task.moved", {
          taskId: task.id,
          key: task.key,
          from: task.from,
          to: task.to,
          version: task.version,
          reason: `Commit ${codeChange.sha.slice(0, 7)}`,
        });
      }
      if (workItemId) {
        deps.events.emit(projectId, "node.written", {
          label: "WorkItem",
          id: workItemId,
          version: 1,
          summary: "test_run item open",
        });
      }
    }
    const out = CommitHookResponse.parse({
      codeChangeId: codeChange.id,
      linked: codeChange.linked,
      taskId: codeChange.linked ? (task?.id ?? null) : null,
      workItemId,
    });
    res.status(202).json(out);
  });

  return router;
}
