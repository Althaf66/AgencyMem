// Routes 10, 11 and 27 of contracts.md section 8: the gates snapshot, a decision on one gate, and the
// readiness report. G1 (stage-machine.md T6), G2 (T9, T10) and G3 (T13, T14) are decided here.
import express, { type Router } from "express";
import {
  GateDecisionBody,
  GateView,
  ReadinessCheck,
  ReadinessResponse,
  type GateKey,
  type GateStatus,
} from "@agencymem/contracts";
import { readQuery, type FalkorDB } from "@agencymem/graph";
import { writeVersioned } from "@agencymem/memory";
import type { Events } from "../events/bus";
import { reject, rejectAndCount, version } from "../mcp/guards";
import { runStage } from "../stage/effects";
import { MISSING_ACTOR, headerNode, parseBody, pathProject, personActor, sendError } from "./http";

const DECISION = "POST /api/gates/:id/decision";
// stage-machine.md section 5: G1 cannot be rejected.
const NO_REJECT: Partial<Record<GateKey, string>> = {
  G1: "G1 cannot be rejected; answer the questions instead.",
};

/** A read/gates row; close.ts reads the launch facts from it too. */
export type Row = {
  g: { properties: Record<string, unknown> };
  discoveryDone: number;
  openQuestions: number;
  proposalDone: number;
  proposalOpen: number;
  architectDone: number;
  architectOpen: number;
  /** The newest launch item's status, and whether the newest ReadinessReport passed (the close). */
  lastLaunch: string | null;
  reportPassed: boolean | null;
};

/** canDecide and blockedBy from the gate rules (stage-machine.md section 5). */
function rules(key: GateKey, status: GateStatus, row: Row): string[] {
  if (status !== "waiting") return []; // decided; an approved gate stays approved
  if (key === "G2") {
    if (row.proposalOpen > 0) return ["Proposal is still working"];
    return row.proposalDone === 0 ? ["No proposal yet"] : [];
  }
  if (key === "G3") {
    if (row.architectOpen > 0) return ["Architect still working"];
    return row.architectDone === 0 ? ["No design yet"] : [];
  }
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

  // 27. GET /api/projects/:id/readiness: the newest report, or null.
  router.get("/projects/:id/readiness", async (req, res) => {
    const db = await deps.db();
    const found = await pathProject(db, req.params.id);
    if (!found.ok) return sendError(res, found.error);
    const [row] = await readQuery<{
      id: string;
      passed: boolean;
      override: boolean;
      checks: string;
      createdAt: number;
    }>(db, found.graph, "read/readiness-report", { projectId: found.id });
    res.json(
      ReadinessResponse.parse({
        report: row
          ? { ...row, checks: ReadinessCheck.array().parse(JSON.parse(row.checks)) }
          : null,
      }),
    );
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

    const { decision } = body.data;
    const reason = body.data.reason?.trim() || null;
    if (decision === "reject" && NO_REJECT[key]) {
      return sendError(res, { code: "VALIDATION_FAILED", reason: NO_REJECT[key] });
    }
    if (decision === "reject" && !reason) {
      return sendError(res, { code: "VALIDATION_FAILED", reason: "A rejection needs a reason." });
    }
    const rows = await readQuery<Row>(db, graph, "read/gates", { projectId });
    const row = rows.find((r) => r.g.properties.id === props.id)!;
    const view = toView(row);
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

    // ponytail: the rules are read before this write, not inside it. For G1 and G2 nothing can
    // turn a waiting gate's rule false again (no Question reopens; only a G2 reject opens a
    // proposal item), so the version check guards the race. For G3, a chat (T12) landing between
    // this read and the write still opens its architect_revise item after the approval; that item
    // revises the documents during planning. Check the rule inside the write if that ever matters.
    const status = decision === "approve" ? "approved" : "rejected";
    const written = await writeVersioned(
      { db, graph, projectId },
      {
        id: view.id,
        version: body.data.version,
        // An approval clears the reason of an earlier rejection (null removes it, C10); the
        // revision item keeps that reason as its note.
        props: { status, decidedBy: actor, decidedAt: Date.now(), reason },
      },
    );
    if (written === null) {
      const refused = reject("version", "VERSION_OLD", `${key} changed on another screen.`);
      return sendError(res, await rejectAndCount(db, projectId, refused, at));
    }
    // gate.changed goes out after the stage machine ran: there is no stage event, so a client
    // reads the project's new stage when this event reloads it.
    let opened;
    try {
      opened = await runStage(db, deps.events, projectId, {
        type: "gate_decided",
        key,
        decision,
        ...(reason ? { reason } : {}),
        actor,
      });
    } finally {
      deps.events.emit(projectId, "gate.changed", {
        gateId: view.id,
        gateKey: key,
        status,
        decidedBy: actor,
        reason,
      });
    }
    const gate = (await readViews(db, graph, projectId)).find((g) => g.id === view.id)!;
    res.json({ gate, opened });
  });

  return router;
}
