// Routes 10 and 11 of contracts.md section 8: the gates snapshot, and a decision on one gate.
// G1 is decided here (stage-machine.md T6); the other gates arrive with their tasks.
import express, { type Router } from "express";
import { GateDecisionBody, GateView, type GateKey, type GateStatus } from "@agencymem/contracts";
import { readQuery, type FalkorDB } from "@agencymem/graph";
import { writeVersioned } from "@agencymem/memory";
import type { Events } from "../events/bus";
import { reject, rejectAndCount, version } from "../mcp/guards";
import { runStage } from "../stage/effects";
import { MISSING_ACTOR, headerNode, parseBody, pathProject, personActor, sendError } from "./http";

const DECISION = "POST /api/gates/:id/decision";
// ponytail: the gates whose rules are not built yet are never decidable; each task replaces its line.
const LATER: Partial<Record<GateKey, string>> = { G2: "3.2", G3: "3.5", G5: "5.2", G6: "5.3" };

type Row = {
  g: { properties: Record<string, unknown> };
  discoveryDone: number;
  openQuestions: number;
};

/** canDecide and blockedBy from the gate rules (stage-machine.md section 5). */
function rules(key: GateKey, status: GateStatus, row: Row): string[] {
  if (status !== "waiting") return []; // decided; an approved gate stays approved
  if (LATER[key]) return [`Not built yet (task ${LATER[key]})`];
  if (row.discoveryDone === 0) return ["Discovery is not done"];
  const n = row.openQuestions;
  return n ? [`${n} ${n === 1 ? "question" : "questions"} still open`] : [];
}

function toView(row: Row): GateView {
  const p = row.g.properties;
  const key = p.key as GateKey;
  const status = p.status as GateStatus;
  const blockedBy = rules(key, status, row);
  return GateView.parse({
    id: p.id,
    key,
    status,
    version: p.version,
    decidedBy: p.decidedBy ?? null,
    decidedAt: p.decidedAt ?? null,
    reason: p.reason ?? null,
    canDecide: status === "waiting" && blockedBy.length === 0,
    blockedBy,
    task: null, // G6 only (task 5.3)
  });
}

async function readViews(db: FalkorDB, graph: string, projectId: string) {
  const rows = await readQuery<Row>(db, graph, "read/gates", { projectId });
  return rows.map(toView);
}

export function gatesRouter(deps: { db: () => Promise<FalkorDB>; events: Events }): Router {
  const router = express.Router();

  // 10. GET /api/projects/:id/gates (snapshot)
  router.get("/projects/:id/gates", async (req, res) => {
    const db = await deps.db();
    const found = await pathProject(db, req.params.id);
    if (!found.ok) return sendError(res, found.error);
    const seq = deps.events.current(found.id); // read before the snapshot (C12)
    res.json({ gates: await readViews(db, found.graph, found.id), seq });
  });

  // 11. POST /api/gates/:id/decision. Guards: tenancy, gate (the gate rules), version.
  router.post("/gates/:id/decision", async (req, res) => {
    const body = parseBody(GateDecisionBody, req.body);
    if (!body.ok) return sendError(res, body.error);
    const actor = personActor(req);
    if (!actor) return sendError(res, MISSING_ACTOR);
    const db = await deps.db();
    const at = { events: deps.events, tool: DECISION, agent: actor };
    const found = await headerNode(db, req, "Gate", at);
    if (!found.ok) return sendError(res, found.error);
    const { projectId, graph, props } = found;
    const key = props.key as GateKey;

    if (LATER[key]) {
      return sendError(res, {
        code: "INTERNAL",
        reason: `Deciding ${key} is not built yet (task ${LATER[key]}).`,
      });
    }
    if (body.data.decision === "reject") {
      return sendError(res, {
        code: "VALIDATION_FAILED",
        reason: "G1 cannot be rejected; answer the questions instead.",
      });
    }
    const view = (await readViews(db, graph, projectId)).find((g) => g.id === props.id)!;
    if (!view.canDecide) {
      const blockedBy = view.blockedBy.length ? view.blockedBy : [`${key} is ${view.status}`];
      const refused = reject("gate", "GATE_NOT_DECIDABLE", `${key} cannot be decided yet.`, {
        gateKey: key,
        status: view.status,
        blockedBy,
      });
      return sendError(res, await rejectAndCount(db, projectId, refused, at));
    }
    const stale = version(body.data.version, view.version);
    if (stale) return sendError(res, await rejectAndCount(db, projectId, stale, at));

    // ponytail: the rules are read before this write, not inside it. G1's rule cannot turn false
    // again (no Question reopens), so the version check alone guards the race.
    const written = await writeVersioned(
      { db, graph, projectId },
      {
        id: view.id,
        version: body.data.version,
        props: { status: "approved", decidedBy: actor, decidedAt: Date.now() },
      },
    );
    if (written === null) {
      const refused = reject("version", "VERSION_OLD", `${key} changed on another screen.`);
      return sendError(res, await rejectAndCount(db, projectId, refused, at));
    }
    deps.events.emit(projectId, "gate.changed", {
      gateId: view.id,
      gateKey: key,
      status: "approved",
      decidedBy: actor,
      reason: null,
    });
    const opened = await runStage(db, deps.events, projectId, {
      type: "gate_decided",
      key,
      decision: "approve",
      actor,
    });
    const gate = (await readViews(db, graph, projectId)).find((g) => g.id === view.id)!;
    res.json({ gate, opened });
  });

  return router;
}
