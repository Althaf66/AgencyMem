// Routes 12 to 15 and 31 of contracts.md section 8: the board snapshot, a person's edit of a card
// (stage-machine.md section 6, H1 to H7, with the human-wins rule of section 8), the progress header
// and its lists, and the retry of a blocked item.
import express, { type Router } from "express";
import {
  CardView,
  Column,
  GateStatus,
  ItemView,
  Lane,
  PatchTaskBody,
  ProgressMetric,
  WorkItem,
  type GateKey,
  type Rejection,
} from "@agencymem/contracts";
import { readQuery, type FalkorDB } from "@agencymem/graph";
import { patchTask, retryItem } from "@agencymem/memory";
import type { Events } from "../events/bus";
import { reject, rejectAndCount, version } from "../mcp/guards";
import { agentFor } from "../mcp/tools/recall-context";
import { projectInfo } from "../project-info";
import { runStage } from "../stage/effects";
import { MISSING_ACTOR, headerNode, parseBody, pathProject, personActor, sendError } from "./http";

const PATCH = "PATCH /api/tasks/:id";
const RETRY = "POST /api/items/:id/retry";
/** stage-machine.md section 3: a card is shown Blocked after 2 failed attempts. */
const BLOCKED_AT = 2;
const DONE_ITEMS = 5; // the agent strip shows the five most recently done items

type Props = Record<string, unknown>;
type BoardRow = {
  t: { properties: Props };
  requirementKey: string | null;
  dependsOn: string[];
  crs: [string, string, number][];
  commits: { sha: string; message: string; committedAt: number; linked: boolean }[];
  criteria: CardView["criteria"];
  runs: { passed: boolean; ranAt: number }[];
};

/** none: no TestCase; pending: no run yet; then the result of the newest run. */
function testStatus(row: BoardRow): CardView["testStatus"] {
  if (row.criteria.every((k) => k.testCaseCount === 0)) return "none";
  if (row.runs.length === 0) return "pending";
  // ponytail: the newest run alone decides; Phase 4 test runs may want the newest run per TestCase.
  const newest = row.runs.reduce((a, b) => (b.ranAt > a.ranAt ? b : a));
  return newest.passed ? "passing" : "failing";
}

function toCard(row: BoardRow): CardView {
  const t = row.t.properties;
  const crs = [...row.crs].sort((a, b) => a[2] - b[2]);
  return CardView.parse({
    id: t.id,
    key: t.key,
    title: t.title,
    description: t.description,
    lane: t.lane,
    column: t.column,
    order: t.order,
    kind: t.kind,
    version: t.version,
    attempts: t.attempts,
    blocked: Number(t.attempts) >= BLOCKED_AT,
    note: t.note ?? null,
    leaseHolder: t.leaseOwner ?? null,
    leaseUntil: t.leaseUntil ?? null,
    testStatus: testStatus(row),
    commits: [...row.commits].sort((a, b) => a.committedAt - b.committedAt),
    rework: t.column === "Rework",
    crIds: crs.map((c) => c[0]),
    crKeys: crs.map((c) => c[1]),
    requirementKey: row.requirementKey,
    dependsOn: row.dependsOn,
    criteria: [...row.criteria].sort((a, b) => a.key.localeCompare(b.key)),
    gate: null, // a fix card's G6 (task 5.3)
    mergedSha: t.mergedSha ?? null,
  });
}

const readCards = async (db: FalkorDB, graph: string, projectId: string, taskId: string | null) =>
  (await readQuery<BoardRow>(db, graph, "read/board", { projectId, taskId })).map(toCard);

function toItem(w: Props): ItemView {
  const item = WorkItem.parse(w);
  return ItemView.parse({
    id: item.id,
    kind: item.kind,
    agent: agentFor(item.kind),
    status: item.status,
    leaseOwner: item.leaseOwner,
    leaseUntil: item.leaseUntil,
    attempts: item.attempts,
    // Run steps are not stored; the handoff, else the summary sent with complete_item, is the last
    // word on a done item. Never `note`: that is the item's input (a G2 reason, a CR text).
    lastStep: item.handoff ?? item.summary ?? null,
    doneAt: item.doneAt,
  });
}

async function readItems(db: FalkorDB, graph: string, projectId: string): Promise<ItemView[]> {
  const rows = await readQuery<{ w: { properties: Props } }>(db, graph, "read/board-items", {
    projectId,
  });
  const items = rows.map((r) => toItem(r.w.properties));
  const done = items
    .filter((i) => i.status === "done")
    .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))
    .slice(0, DONE_ITEMS);
  return [...items.filter((i) => i.status !== "done"), ...done];
}

/** The criterion keys of a card that have no TestCase yet (H2). */
async function uncovered(db: FalkorDB, graph: string, projectId: string, taskId: string) {
  const [card] = await readCards(db, graph, projectId, taskId);
  return (card?.criteria ?? []).filter((k) => k.testCaseCount === 0).map((k) => k.key);
}

const invalid = (reason: string): Rejection => ({ code: "VALIDATION_FAILED", reason });

export function tasksRouter(deps: { db: () => Promise<FalkorDB>; events: Events }): Router {
  const router = express.Router();

  // 12. GET /api/projects/:id/board (snapshot)
  router.get("/projects/:id/board", async (req, res) => {
    const db = await deps.db();
    const found = await pathProject(db, req.params.id);
    if (!found.ok) return sendError(res, found.error);
    const seq = deps.events.current(found.id); // read before the snapshot (C12)
    res.json({
      columns: Column.options,
      lanes: Lane.options,
      cards: await readCards(db, found.graph, found.id, null),
      items: await readItems(db, found.graph, found.id),
      seq,
    });
  });

  // 13. PATCH /api/tasks/:id with X-AM-Project. Guards: tenancy, evidence (H2), version. A move the
  // rules do not allow from the card's column is VALIDATION_FAILED, like H7.
  router.patch("/tasks/:id", async (req, res) => {
    const actor = personActor(req);
    if (!actor) return sendError(res, MISSING_ACTOR);
    const body = parseBody(PatchTaskBody, req.body);
    if (!body.ok) return sendError(res, body.error);
    const db = await deps.db();
    const at = { events: deps.events, tool: PATCH, agent: actor };
    const found = await headerNode(db, req, "Task", at);
    if (!found.ok) return sendError(res, found.error);
    const { projectId, graph, props: t } = found;
    const edit = body.data;
    const from = t.column as Column;
    const now = Date.now();

    if (edit.criteria && edit.column) {
      return sendError(res, invalid("Edit the criteria or move the card, not both at once."));
    }
    // A criterion key names its card (AC-04-2 on CARD-04), so an edit never reaches another card's.
    const own = `AC-${String(t.key).slice("CARD-".length)}-`;
    const foreign = edit.criteria?.find((k) => !k.key.startsWith(own));
    if (foreign) {
      return sendError(res, invalid(`H3: ${foreign.key} is not a criterion of ${String(t.key)}.`));
    }
    // AGENTS.md rule 8: the version guard runs before the evidence guard (H2).
    const stale = version(edit.version, Number(t.version));
    if (stale) return sendError(res, await rejectAndCount(db, projectId, stale, at));
    const fields = (["title", "description", "lane", "order"] as const).filter(
      (f) => edit[f] !== undefined,
    );
    const props: Record<string, string | number | null> = {};
    for (const f of fields) props[f] = edit[f]!;
    let to = from;
    if (edit.column === "Ready") {
      if (from !== "Backlog" && from !== "Rework") {
        return sendError(res, invalid("H2: only a Backlog or Rework card moves to Ready."));
      }
      const missing = await uncovered(db, graph, projectId, String(t.id));
      if (missing.length) {
        const refused = reject(
          "evidence",
          "NO_TESTS",
          `H2: every criterion needs a TestCase first; ${missing.join(", ")} have none.`,
          { cases: missing },
        );
        return sendError(res, await rejectAndCount(db, projectId, refused, at));
      }
    }
    if (edit.column === "Rework" && from !== "Done") {
      return sendError(res, invalid("H4: only a Done card is reopened."));
    }
    if (edit.column === "Backlog" && from !== "Ready") {
      return sendError(res, invalid("H5: only a Ready card is parked in Backlog."));
    }
    if (edit.column) to = edit.column;
    if (edit.unblock) {
      if (Number(t.attempts) < BLOCKED_AT) {
        return sendError(res, invalid("H6: the card is not blocked."));
      }
      props.attempts = 0;
    }
    if (edit.criteria) {
      if (from === "Done") return sendError(res, invalid("H3: a Done card's criteria are fixed."));
      if (from !== "Backlog") to = "Rework";
    }
    // Human wins (section 8): the person's edit cancels the worker's lease; a card it was working
    // on goes back to Ready for a fresh run.
    const leased = t.leaseOwner != null;
    if (leased) {
      props.leaseOwner = null;
      props.leaseUntil = null;
      if (to === from && (from === "In progress" || from === "Testing")) to = "Ready";
    }
    if (to !== from) props.column = to;

    const written = await patchTask(
      { db, graph, projectId },
      {
        id: String(t.id),
        version: edit.version,
        props,
        criteria: edit.criteria ?? null,
        createdBy: actor,
        now,
      },
    );
    if (!written) {
      const refused = reject("version", "VERSION_OLD", "The card changed on another screen.");
      return sendError(res, await rejectAndCount(db, projectId, refused, at));
    }

    const taskId = String(t.id);
    const edited = [
      ...fields,
      ...(edit.criteria ? ["criteria"] : []),
      ...(edit.unblock ? ["attempts"] : []),
    ];
    if (edited.length) {
      deps.events.emit(projectId, "task.edited", {
        taskId,
        fields: edited,
        version: written.version,
        actor,
      });
    }
    if (leased) {
      deps.events.emit(projectId, "lease.changed", {
        itemId: taskId,
        owner: null,
        until: null,
        reason: "cancel",
      });
    }
    if (to !== from) {
      deps.events.emit(projectId, "task.moved", {
        taskId,
        key: String(t.key),
        from,
        to,
        version: written.version,
      });
    }
    if (edit.criteria) {
      await runStage(db, deps.events, projectId, { type: "criteria_edited", taskId, actor });
    }
    if (to === "Ready" && to !== from) {
      await runStage(db, deps.events, projectId, { type: "card_ready" }); // T16 from H2
    }
    const [task] = await readCards(db, graph, projectId, taskId);
    res.json({ task });
  });

  // 14. GET /api/projects/:id/progress (snapshot)
  router.get("/projects/:id/progress", async (req, res) => {
    const db = await deps.db();
    const found = await pathProject(db, req.params.id);
    if (!found.ok) return sendError(res, found.error);
    const seq = deps.events.current(found.id);
    const project = await projectInfo(db, found.id);
    const gates = await readQuery<{ g: { properties: { key: GateKey; status: GateStatus } } }>(
      db,
      found.graph,
      "read/gates",
      { projectId: found.id },
    );
    const [row] = await readQuery<{
      cards: { lane: Lane; done: boolean }[];
      total: number;
      covered: number;
      openAssumptions: number;
      openDefects: number;
    }>(db, found.graph, "read/progress", { projectId: found.id });
    const cards = row?.cards ?? [];
    res.json({
      stage: project!.stage,
      gates: gates.map((g) => ({ key: g.g.properties.key, status: g.g.properties.status })),
      lanes: Lane.options.map((lane) => ({
        lane,
        done: cards.filter((c) => c.lane === lane && c.done).length,
        total: cards.filter((c) => c.lane === lane).length,
      })),
      coverage: { covered: row?.covered ?? 0, total: row?.total ?? 0 },
      openAssumptions: row?.openAssumptions ?? 0,
      openDefects: row?.openDefects ?? 0,
      seq,
    });
  });

  // 15. GET /api/projects/:id/progress/:metric: the nodes behind one number of the header.
  router.get("/projects/:id/progress/:metric", async (req, res) => {
    const metric = ProgressMetric.safeParse(req.params.metric);
    if (!metric.success) {
      return sendError(
        res,
        invalid("metric is lane:<Lane>, coverage, openAssumptions or openDefects."),
      );
    }
    const db = await deps.db();
    const found = await pathProject(db, req.params.id);
    if (!found.ok) return sendError(res, found.error);
    const params = { projectId: found.id };
    const nodes = metric.data.startsWith("lane:")
      ? await readQuery(db, found.graph, "read/progress-lane", {
          ...params,
          lane: metric.data.slice("lane:".length),
        })
      : await readQuery(db, found.graph, QUERY_OF[metric.data as keyof typeof QUERY_OF], params);
    res.json({
      nodes: nodes.map((n) =>
        Object.fromEntries(Object.entries(n as Props).filter(([, v]) => v !== null)),
      ),
    });
  });

  // 31. POST /api/items/:id/retry with X-AM-Project: a blocked item back to open, attempts 0.
  router.post("/items/:id/retry", async (req, res) => {
    const actor = personActor(req);
    if (!actor) return sendError(res, MISSING_ACTOR);
    const db = await deps.db();
    const at = { events: deps.events, tool: RETRY, agent: actor };
    const found = await headerNode(db, req, "WorkItem", at);
    if (!found.ok) return sendError(res, found.error);
    const item = await retryItem(
      { db, graph: found.graph, projectId: found.projectId },
      { id: String(found.props.id) },
    );
    if (!item) return sendError(res, invalid("Only a blocked item is retried."));
    deps.events.emit(found.projectId, "node.written", {
      label: "WorkItem",
      id: item.id,
      version: item.version,
      summary: `${item.kind} item open again`,
    });
    res.json({ item });
  });

  return router;
}

const QUERY_OF = {
  coverage: "read/progress-coverage",
  openAssumptions: "read/progress-assumptions",
  openDefects: "read/progress-defects",
} as const;
