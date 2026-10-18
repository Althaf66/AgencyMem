// Routes 16, 17 and 18 of contracts.md section 8: the graph panel's nodes (all, or around a focus),
// the why path of any node and the impact path of a Fact, each as a GraphView (ui.md graph panel).
import express, { type Request, type Response, type Router } from "express";
import { GraphQuery, GraphView, Id, PathResponse, type Rejection } from "@agencymem/contracts";
import { readQuery, type FalkorDB } from "@agencymem/graph";
import type { Events } from "../events/bus";
import { rejectAndCount, tenancy } from "../mcp/guards";
import { pathProject, personActor, sendError } from "./http";
import { titleOf } from "./nodes";

type Props = Record<string, unknown>;
type NodeRow = { p: Props; label: string };
type LinkRow = { source: string; target: string; type: string };
type PathRow = NodeRow & { nodes: NodeRow[][]; links: LinkRow[][] };
type Node = GraphView["nodes"][number];

/** The node groups of ui.md section 3, which colour the graph stage. */
const GROUPS: Record<string, string[]> = {
  Sources: ["Document", "Episode"],
  Knowledge: ["Entity", "Fact", "Contradiction", "Question", "Assumption"],
  Product: ["Requirement", "Feature", "Estimate", "AcceptanceCriterion", "ChangeRequest"],
  Design: ["Decision", "Component", "Screen", "DataEntity", "Endpoint", "Risk", "DocSection"],
};
const groupOf = (label: string) =>
  Object.keys(GROUPS).find((g) => GROUPS[g]!.includes(label)) ?? "Delivery";

const str = (v: unknown) => (v === undefined || v === null ? null : String(v));
const num = (v: unknown) => (typeof v === "number" ? v : null);

function stateOf(p: Props, label: string): Node["state"] {
  if ((label === "Fact" || label === "Requirement") && p.validTo != null) return "ended";
  if (label === "DocSection" && p.stale === true) return "stale";
  if (label === "Task" && p.column === "Rework") return "rework";
  if (label === "TestRun" && p.passed === false) return "failing";
  return null;
}

export function toNode({ p, label }: NodeRow): Node {
  const id = String(p.id);
  const title = titleOf({
    id,
    label,
    kind: str(p.kind),
    page: num(p.page),
    lineStart: num(p.lineStart),
    lineEnd: num(p.lineEnd),
    name: str(p.name),
    statement: str(p.statement),
    text: str(p.text),
    key: str(p.key),
    title: str(p.title),
  });
  const node: Node = { id, label, title, group: groupOf(label), state: stateOf(p, label) };
  // The graph's time slider replays the nodes in the order they were written.
  if (typeof p.createdAt === "number") node.createdAt = p.createdAt;
  return node;
}

/** A short value for an edge (contracts.md GraphView): a run's result, an estimate's hours. */
function linkLabel(type: string, source: NodeRow | undefined): string | null {
  if (type === "RUNS" && source) return source.p.passed === true ? "passed" : "failed";
  if (type === "FOR" && source && typeof source.p.hours === "number") return `${source.p.hours} h`;
  return null;
}

/** One GraphView from node and link rows, each node and link once. */
function view(nodeRows: NodeRow[], linkRows: LinkRow[]): GraphView {
  const nodes = new Map(nodeRows.map((r) => [String(r.p.id), r]));
  const links = new Map(linkRows.map((l) => [`${l.source}|${l.type}|${l.target}`, l]));
  return GraphView.parse({
    nodes: [...nodes.values()].map(toNode),
    links: [...links.values()].map((l) => ({
      ...l,
      label: linkLabel(l.type, nodes.get(l.source)),
    })),
  });
}

export function graphRouter(deps: { db: () => Promise<FalkorDB>; events: Events }): Router {
  const router = express.Router();

  /** The project, its graph and a start node in it (404 unknown, 403 another project's). */
  async function start(
    req: Request,
    tool: string,
    raw: string | undefined,
  ): Promise<
    | { ok: true; db: FalkorDB; projectId: string; graph: string; label: string }
    | { ok: false; error: Rejection }
  > {
    const db = await deps.db();
    const found = await pathProject(db, req.params.id as string);
    if (!found.ok) return found;
    const base = { ok: true as const, db, projectId: found.id, graph: found.graph, label: "" };
    if (raw === undefined) return base;
    const id = Id.safeParse(raw);
    if (!id.success) {
      return {
        ok: false,
        error: { code: "VALIDATION_FAILED", reason: "The node id is not an id." },
      };
    }
    const [row] = await readQuery<{ n: { properties: Props }; label: string }>(
      db,
      found.graph,
      "read/node",
      { id: id.data },
    );
    if (!row)
      return { ok: false, error: { code: "NOT_FOUND", reason: `Unknown node ${id.data}.` } };
    const foreign = tenancy({
      projectId: found.id,
      known: true,
      nodes: [{ id: id.data, projectId: String(row.n.properties.projectId) }],
    });
    if (foreign) {
      const at = { events: deps.events, tool, agent: personActor(req) ?? "human:ui" };
      return { ok: false, error: await rejectAndCount(db, found.id, foreign, at) };
    }
    return { ...base, label: row.label };
  }

  router.get("/projects/:id/graph", async (req, res) => {
    const query = GraphQuery.safeParse(req.query);
    if (!query.success) {
      return sendError(res, {
        code: "VALIDATION_FAILED",
        reason: "depth is 1 to 3, limit 1 to 500, focus a node id.",
      });
    }
    const { focus, depth, limit = 500 } = query.data;
    const s = await start(req, "GET /api/projects/:id/graph", focus);
    if (!s.ok) return sendError(res, s.error);
    const params = { projectId: s.projectId, limit };
    const nodes = focus
      ? await readQuery<NodeRow>(s.db, s.graph, "read/graph-focus", { ...params, focus, depth })
      : await readQuery<NodeRow>(s.db, s.graph, "read/graph-nodes", params);
    const ids = nodes.map((n) => String(n.p.id));
    const links = await readQuery<LinkRow>(s.db, s.graph, "read/graph-links", {
      projectId: s.projectId,
      ids,
    });
    res.json(view(nodes, links));
  });

  async function path(req: Request, res: Response, tool: string, query: string, only?: string) {
    const s = await start(req, tool, req.params.nodeId as string);
    if (!s.ok) return sendError(res, s.error);
    if (only && s.label !== only) {
      return sendError(res, { code: "VALIDATION_FAILED", reason: `The node is not a ${only}.` });
    }
    const t0 = performance.now();
    const [row] = await readQuery<PathRow>(s.db, s.graph, query, {
      id: req.params.nodeId as string,
    });
    const ms = Math.round(performance.now() - t0);
    const { nodes, links } = row!;
    res.json(PathResponse.parse({ path: view([row!, ...nodes.flat()], links.flat()), ms }));
  }

  router.get("/projects/:id/why/:nodeId", (req, res) =>
    path(req, res, "GET /api/projects/:id/why/:nodeId", "read/why"),
  );
  router.get("/projects/:id/impact/:nodeId", (req, res) =>
    path(req, res, "GET /api/projects/:id/impact/:nodeId", "read/impact-path", "Fact"),
  );
  // The Read view: what a WorkItem or Task read from the graph (its RECALLED edges).
  router.get("/projects/:id/recalled/:nodeId", (req, res) =>
    path(req, res, "GET /api/projects/:id/recalled/:nodeId", "read/recalled"),
  );

  return router;
}
