// Route 30 of contracts.md section 8: POST /api/runs/steps with the agent token. A runner or build
// worker posts one line of an item's work; the gateway sends it as one run.step event (C7). No lease
// guard: the last step can arrive after the item is done.
import express, { type Router } from "express";
import { RunStepBody } from "@agencymem/contracts";
import { readQuery, type FalkorDB } from "@agencymem/graph";
import type { Events } from "../events/bus";
import { rejectAndCount, tenancy } from "../mcp/guards";
import { bindSession } from "../mcp/session";
import { parseBody, sendError } from "./http";

const TOOL = "POST /api/runs/steps";

export function runsRouter(deps: { db: () => Promise<FalkorDB>; events: Events }): Router {
  const router = express.Router();

  router.post("/steps", async (req, res) => {
    const body = parseBody(RunStepBody, req.body);
    if (!body.ok) return sendError(res, body.error);
    // The same header rules as an agent MCP session: X-AM-Agent, X-AM-Project, X-AM-Worker.
    const bound = await bindSession((name) => req.get(name), "agent", deps.db);
    if (!bound.ok) return res.status(bound.status).json({ error: bound.error });
    // bindSession("agent") always binds an agent; anything else is a bug, answered 500 by onError.
    if (bound.binding.kind !== "agent") throw new Error("route 30 bound a non-agent session");
    const { agent, projectId, graph } = bound.binding;
    if (body.data.final) {
      // A final step also writes a Run node; the build workers that send it arrive in task 4.6.
      return sendError(res, {
        code: "INTERNAL",
        reason: "final steps are not built yet (task 4.6).",
      });
    }

    // Tenancy: the item (a WorkItem or a Task) belongs to the header's project.
    const db = await deps.db();
    const [row] = await readQuery<{ n: { properties: { projectId?: string } }; label: string }>(
      db,
      graph,
      "read/node",
      { id: body.data.itemId },
    );
    if (!row || !["WorkItem", "Task"].includes(row.label)) {
      return sendError(res, { code: "NOT_FOUND", reason: `No item ${body.data.itemId}.` });
    }
    const foreign = tenancy({
      projectId,
      known: true,
      nodes: [{ id: body.data.itemId, projectId: row.n.properties.projectId ?? null }],
    });
    if (foreign) {
      const at = { events: deps.events, tool: TOOL, agent };
      return sendError(res, await rejectAndCount(db, projectId, foreign, at));
    }

    const { itemId, step, text, model, tokensIn, tokensOut, ms } = body.data;
    deps.events.emit(projectId, "run.step", {
      itemId,
      agent,
      step,
      text,
      model: model ?? null,
      tokens: (tokensIn ?? 0) + (tokensOut ?? 0),
      ms: ms ?? 0,
    });
    res.status(202).json({});
  });

  return router;
}
