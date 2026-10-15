// Routes 20 and 21 of contracts.md section 8: a document rendered from its sections and the nodes
// they render, and chat on the documents (stage-machine.md T12, or C1 after G3).
import express, { type Router } from "express";
import { ChatBody, Doc, DocResponse, type GateStatus } from "@agencymem/contracts";
import { REGISTRY_GRAPH, graphFor, readQuery, type FalkorDB } from "@agencymem/graph";
import { writeHumanEdit } from "@agencymem/memory";
import type { Events } from "../events/bus";
import { reject, rejectAndCount, tenancy } from "../mcp/guards";
import { runStage } from "../stage/effects";
import { readStageState } from "../stage/state";
import { OPEN_STAGES, openChangeRequest } from "./change-requests";
import { MISSING_ACTOR, parseBody, pathProject, personActor, sendError } from "./http";

const CHAT = "POST /api/chat";
type Props = Record<string, unknown>;

export function docsRouter(deps: { db: () => Promise<FalkorDB>; events: Events }): Router {
  const router = express.Router();

  // 20. GET /api/projects/:id/docs/:doc (snapshot): the sections in order, each with the nodes it
  // renders; designVersion is the project's.
  router.get("/projects/:id/docs/:doc", async (req, res) => {
    const doc = Doc.safeParse(req.params.doc);
    if (!doc.success) {
      return sendError(res, { code: "VALIDATION_FAILED", reason: "doc is prd, tdd or plan." });
    }
    const db = await deps.db();
    const found = await pathProject(db, req.params.id);
    if (!found.ok) return sendError(res, found.error);
    const seq = deps.events.current(found.id); // read before the snapshot (C12)
    const rows = await readQuery<{ s: { properties: Props }; renders: unknown[] }>(
      db,
      found.graph,
      "read/doc-sections",
      { projectId: found.id, doc: doc.data },
    );
    const [versions] = await readQuery<{ designVersion: number }>(
      db,
      found.graph,
      "read/product-versions",
      { projectId: found.id },
    );
    res.json(
      DocResponse.parse({
        doc: doc.data,
        sections: rows.map(({ s, renders }) => ({ ...s.properties, renders })),
        designVersion: versions?.designVersion ?? 0,
        seq,
      }),
    );
  });

  // 21. POST /api/chat with X-AM-Project. Before G3 is approved, in design: a human_edit Episode and
  // an architect_revise item (T12). After G3: a change request (C1). Otherwise 409.
  router.post("/chat", async (req, res) => {
    const actor = personActor(req);
    if (!actor) return sendError(res, MISSING_ACTOR);
    const body = parseBody(ChatBody, req.body);
    if (!body.ok) return sendError(res, body.error);
    const db = await deps.db();
    const at = { events: deps.events, tool: CHAT, agent: actor };

    // Guards in order: tenancy (the project, then the section), then the stage rules (gate).
    const projectId = req.get("X-AM-Project");
    const known = projectId
      ? (await readQuery(db, REGISTRY_GRAPH, "read/project", { projectId })).length > 0
      : false;
    const missing = tenancy({ projectId, known });
    if (missing) return sendError(res, await rejectAndCount(db, projectId ?? "", missing, at));
    const found = { id: projectId!, graph: await graphFor(db, projectId!) };
    const ctx = { db, graph: found.graph, projectId: found.id };

    let section: Props | null = null;
    if (body.data.docSectionId) {
      const [row] = await readQuery<{ n: { properties: Props }; label: string }>(
        db,
        found.graph,
        "read/node",
        { id: body.data.docSectionId },
      );
      if (row?.label !== "DocSection") {
        return sendError(res, {
          code: "NOT_FOUND",
          reason: `Unknown DocSection ${body.data.docSectionId}.`,
        });
      }
      const foreign = tenancy({
        projectId,
        known,
        nodes: [{ id: body.data.docSectionId, projectId: String(row.n.properties.projectId) }],
      });
      if (foreign) return sendError(res, await rejectAndCount(db, found.id, foreign, at));
      section = row.n.properties;
    }

    const gates = await readQuery<{ g: { properties: { key: string; status: GateStatus } } }>(
      db,
      found.graph,
      "read/gates",
      { projectId: found.id },
    );
    const g3 = gates.find((r) => r.g.properties.key === "G3")?.g.properties.status;
    const state = await readStageState(db, found.id, found.graph);
    const stage = state?.stage;

    if (g3 === "approved" && stage && OPEN_STAGES.includes(stage)) {
      const opened = await openChangeRequest(db, deps.events, found, body.data.text, actor);
      if (!opened.ok) return sendError(res, opened.error);
      const { crId, episodeId, workItemId } = opened.output;
      return res.json({ episodeId, route: "change_request", workItemId, crId });
    }
    if (stage !== "design" || g3 === "approved") {
      const refused = reject(
        "gate",
        "WRONG_STAGE",
        `Chat on the documents is open from design until the project closes; the project is in ${stage}.`,
        { stage: stage ?? null },
      );
      return sendError(res, await rejectAndCount(db, found.id, refused, at));
    }

    // The note names the section the person meant (decided with the developer; no doc says it).
    const note = section
      ? `On section "${String(section.title)}" (${String(section.doc)} ${String(section.order)}): ${body.data.text}`
      : body.data.text;
    if (note.length > 2000) {
      return sendError(res, {
        code: "VALIDATION_FAILED",
        reason: "The text is too long with the section name; shorten it.",
      });
    }
    const episode = await writeHumanEdit(ctx, {
      text: body.data.text,
      createdBy: actor,
      now: Date.now(),
    });
    deps.events.emit(found.id, "node.written", {
      label: "Episode",
      id: episode.id,
      version: episode.version,
      summary: "Chat on the documents",
    });
    const opened = await runStage(db, deps.events, found.id, {
      type: "chat",
      episodeId: episode.id,
      note,
      actor,
    });
    const item = opened.find((o) => o.kind === "architect_revise");
    if (!item) {
      // The startup repair opens it (T12); the episode itself is written.
      return sendError(res, { code: "INTERNAL", reason: "The revision item did not open." });
    }
    res.json({ episodeId: episode.id, route: "doc_revision", workItemId: item.id });
  });

  return router;
}
