// Evidence routes: what the agents did, for the Home feed, the Pipeline screen and the card story.
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import express, { type Router } from "express";
import {
  Id,
  Sha,
  type CommitDiffResponse,
  type EventsResponse,
  type ItemRunsResponse,
  type ItemsResponse,
  type TestRunsResponse,
} from "@agencymem/contracts";
import { readQuery, type FalkorDB } from "@agencymem/graph";
import type { Events } from "../events/bus";
import { pathProject, sendError } from "./http";
import { readItems } from "./tasks";

const run = promisify(execFile);
/** The most patch text one diff answer carries. */
const DIFF_MAX = 300_000;
const AGENCYMEM_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));

/** A project's repository: <WORKSPACES_DIR>/<projectId>/repo, a relative dir read from the
 * AgencyMem root (as the runner's repo.ts does). */
export const repoOf = (workspacesDir: string, projectId: string) =>
  resolve(AGENCYMEM_ROOT, workspacesDir, projectId, "repo");

/** `git show` output as one patch per file. */
export function splitDiff(text: string): CommitDiffResponse["files"] {
  return text
    .split(/^(?=diff --git )/m)
    .filter((part) => part.startsWith("diff --git "))
    .map((patch) => ({
      path: /^diff --git a\/(.+?) b\//.exec(patch)?.[1] ?? "?",
      patch,
    }));
}

export function evidenceRouter(deps: {
  db: () => Promise<FalkorDB>;
  events: Events;
  workspacesDir: string;
}): Router {
  const router = express.Router();

  // GET /api/projects/:id/events: the replay buffer, so a refreshed page still shows recent work.
  router.get("/projects/:id/events", async (req, res) => {
    const found = await pathProject(await deps.db(), req.params.id);
    if (!found.ok) return sendError(res, found.error);
    const body: EventsResponse = { events: deps.events.recent(found.id) };
    res.json(body);
  });

  // GET /api/projects/:id/items (snapshot): the Pipeline's work items, done ones included.
  router.get("/projects/:id/items", async (req, res) => {
    const db = await deps.db();
    const found = await pathProject(db, req.params.id);
    if (!found.ok) return sendError(res, found.error);
    const seq = deps.events.current(found.id); // read before the snapshot (C12)
    const body: ItemsResponse = { items: await readItems(db, found.graph, found.id, true), seq };
    res.json(body);
  });

  // GET /api/projects/:id/commits/:sha/diff: only a sha the graph holds as this project's commit.
  router.get("/projects/:id/commits/:sha/diff", async (req, res) => {
    const db = await deps.db();
    const found = await pathProject(db, req.params.id);
    if (!found.ok) return sendError(res, found.error);
    const sha = Sha.safeParse(req.params.sha);
    if (!sha.success) {
      return sendError(res, {
        code: "VALIDATION_FAILED",
        reason: "The sha is not 40 hex characters.",
      });
    }
    const [known] = await readQuery<{ id: string }>(db, found.graph, "read/commit", {
      projectId: found.id,
      sha: sha.data,
    });
    if (!known) return sendError(res, { code: "NOT_FOUND", reason: `No commit ${sha.data}.` });
    let out: string;
    try {
      const shown = await run(
        "git",
        ["-c", "core.quotepath=off", "show", "--format=", "--no-color", "--no-ext-diff", sha.data],
        { cwd: repoOf(deps.workspacesDir, found.id), maxBuffer: 20 * DIFF_MAX },
      );
      out = shown.stdout;
    } catch {
      return sendError(res, {
        code: "NOT_FOUND",
        reason: "The project's repository does not hold this commit.",
      });
    }
    const body: CommitDiffResponse = {
      sha: sha.data,
      files: splitDiff(out.slice(0, DIFF_MAX)),
      truncated: out.length > DIFF_MAX,
    };
    res.json(body);
  });

  /** The item `raw`, a WorkItem or Task of the project, or null. */
  async function item(
    db: FalkorDB,
    graph: string,
    projectId: string,
    raw: string,
    labels: string[],
  ) {
    if (!Id.safeParse(raw).success) return null;
    const [row] = await readQuery<{ n: { properties: { projectId?: string } }; label: string }>(
      db,
      graph,
      "read/node",
      { id: raw },
    );
    return row && labels.includes(row.label) && row.n.properties.projectId === projectId
      ? raw
      : null;
  }

  // GET /api/projects/:id/items/:itemId/runs: the model calls an item made.
  router.get("/projects/:id/items/:itemId/runs", async (req, res) => {
    const db = await deps.db();
    const found = await pathProject(db, req.params.id);
    if (!found.ok) return sendError(res, found.error);
    const itemId = await item(db, found.graph, found.id, req.params.itemId, ["WorkItem", "Task"]);
    if (!itemId)
      return sendError(res, { code: "NOT_FOUND", reason: `No item ${req.params.itemId}.` });
    const runs = await readQuery<ItemRunsResponse["runs"][number]>(
      db,
      found.graph,
      "read/item-runs",
      {
        itemId,
      },
    );
    const body: ItemRunsResponse = {
      runs: runs.map((r) => ({ ...r, endpoint: r.endpoint ?? null })),
    };
    res.json(body);
  });

  // GET /api/projects/:id/tasks/:taskId/test-runs: a card's test runs.
  router.get("/projects/:id/tasks/:taskId/test-runs", async (req, res) => {
    const db = await deps.db();
    const found = await pathProject(db, req.params.id);
    if (!found.ok) return sendError(res, found.error);
    const taskId = await item(db, found.graph, found.id, req.params.taskId, ["Task"]);
    if (!taskId)
      return sendError(res, { code: "NOT_FOUND", reason: `No card ${req.params.taskId}.` });
    const runs = await readQuery<TestRunsResponse["runs"][number]>(
      db,
      found.graph,
      "read/task-test-runs",
      { projectId: found.id, taskId },
    );
    const body: TestRunsResponse = { runs: runs.map((r) => ({ ...r, error: r.error ?? null })) };
    res.json(body);
  });

  return router;
}
