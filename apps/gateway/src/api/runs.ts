// Route 30 of contracts.md section 8: POST /api/runs/steps with the agent token. A runner or build
// worker posts one line of an item's work; the gateway sends it as one run.step event (C7). No lease
// guard: the last step can arrive after the item is done.
import express, { type Router } from "express";
import { RunStepBody } from "@agencymem/contracts";
import { readQuery, type FalkorDB } from "@agencymem/graph";
import { writeRun } from "@agencymem/memory";
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

    const { itemId, step, text, model, endpoint, tokensIn, tokensOut, ms, cost } = body.data;
    if (body.data.final) {
      // A build worker's last step also writes the run's one Run node (agent-prompts.md section 11).
      if (!model || !endpoint) {
        return sendError(res, {
          code: "VALIDATION_FAILED",
          reason: "A final step needs its model and endpoint.",
        });
      }
      const run = {
        step,
        model,
        endpoint,
        tokensIn: tokensIn ?? 0,
        tokensOut: tokensOut ?? 0,
        ms: ms ?? 0,
        cost: cost ?? 0,
      };
      await writeRun({ db, graph, projectId }, { itemId, agent, run, now: Date.now() });
    }
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
