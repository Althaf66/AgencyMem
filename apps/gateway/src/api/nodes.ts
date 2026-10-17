// Route 6 of contracts.md section 8: GET /api/projects/:id/nodes/:nodeId, a node with its links.
// The screens use it to list a Document's Episodes; later screens patch their store with it.
import express, { type Router } from "express";
import { Id, NodeResponse } from "@agencymem/contracts";
import { readQuery, type FalkorDB } from "@agencymem/graph";
import type { Events } from "../events/bus";
import { rejectAndCount, tenancy } from "../mcp/guards";
import { pathProject, personActor, sendError } from "./http";

const TOOL = "GET /api/projects/:id/nodes/:nodeId";

type Other = {
  id: string;
  label: string;
  kind: string | null;
  page: number | null;
  lineStart: number | null;
  lineEnd: number | null;
  name: string | null;
  statement: string | null;
  text: string | null;
  key: string | null;
  title: string | null;
};
type Row = {
  n: { properties: Record<string, unknown> };
  label: string;
  links: { type: string; direction: "out" | "in"; other: Other }[];
};

/** How a linked node is named in a list (P): what a person reads to tell it from its siblings. */
export function titleOf(o: Other): string {
  switch (o.label) {
    case "Episode":
      if (o.lineStart === null) return o.kind ?? "episode";
      return `${o.page ? `p${o.page} · ` : ""}l${o.lineStart}-${o.lineEnd ?? o.lineStart}`;
    case "Fact":
      return o.statement ?? o.id;
    case "Question":
      return o.text ?? o.id;
    case "WorkItem":
      return o.kind ? `${o.kind} work item` : o.id;
    default:
      return o.key ?? o.name ?? o.title ?? o.id;
  }
}

/** Episodes in page and line order; the other links by type, then id. */
const order = (a: Row["links"][number], b: Row["links"][number]) =>
  (a.other.page ?? 0) - (b.other.page ?? 0) ||
  (a.other.lineStart ?? 0) - (b.other.lineStart ?? 0) ||
  a.type.localeCompare(b.type) ||
  a.other.id.localeCompare(b.other.id);

export function nodesRouter(deps: { db: () => Promise<FalkorDB>; events: Events }): Router {
  const router = express.Router();

  router.get("/projects/:id/nodes/:nodeId", async (req, res) => {
    const db = await deps.db();
    const found = await pathProject(db, req.params.id);
    if (!found.ok) return sendError(res, found.error);
    const nodeId = Id.safeParse(req.params.nodeId);
    if (!nodeId.success) {
      return sendError(res, { code: "VALIDATION_FAILED", reason: "The node id is not an id." });
    }
    const [row] = await readQuery<Row>(db, found.graph, "read/node-links", { id: nodeId.data });
    if (!row) return sendError(res, { code: "NOT_FOUND", reason: `Unknown node ${nodeId.data}.` });
    const foreign = tenancy({
      projectId: found.id,
      known: true,
      nodes: [{ id: nodeId.data, projectId: String(row.n.properties.projectId) }],
    });
    if (foreign) {
      const at = { events: deps.events, tool: TOOL, agent: personActor(req) ?? "human:ui" };
      return sendError(res, await rejectAndCount(db, found.id, foreign, at));
    }
    res.json(
      NodeResponse.parse({
        node: { ...row.n.properties, label: row.label },
        links: [...row.links].sort(order).map((l) => ({
          type: l.type,
          direction: l.direction,
          otherId: l.other.id,
          otherLabel: l.other.label,
          otherTitle: titleOf(l.other),
        })),
      }),
    );
  });

  return router;
}
