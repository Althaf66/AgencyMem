// Routes 8 and 9 of contracts.md section 8: the questionnaire snapshot, and the answer to one
// question (stage-machine.md T5).
import express, { type Router } from "express";
import { AnswerBody, QuestionView, type NodeLabel } from "@agencymem/contracts";
import { readQuery, type FalkorDB } from "@agencymem/graph";
import { answerQuestion } from "@agencymem/memory";
import type { Events } from "../events/bus";
import { reject, rejectAndCount, version } from "../mcp/guards";
import { runStage } from "../stage/effects";
import { MISSING_ACTOR, headerNode, parseBody, pathProject, personActor, sendError } from "./http";

const ANSWER = "POST /api/questions/:id/answer";

type Props = Record<string, unknown>;
type Row = {
  q: { properties: Props };
  a: { properties: Props };
  c: { properties: Props } | null;
  sources: QuestionView["sources"];
  answer: QuestionView["answer"];
};

function toView({ q, a, c, sources, answer }: Row): QuestionView {
  return QuestionView.parse({
    id: q.properties.id,
    kind: q.properties.kind,
    text: q.properties.text,
    recommended: q.properties.recommended,
    reasoning: q.properties.reasoning,
    approach: q.properties.approach,
    status: q.properties.status,
    version: q.properties.version,
    assumption: { id: a.properties.id, text: a.properties.text, status: a.properties.status },
    contradiction: c
      ? { id: c.properties.id, summary: c.properties.summary, status: c.properties.status }
      : null,
    sources,
    answer,
  });
}

async function readViews(db: FalkorDB, graph: string, projectId: string) {
  const rows = await readQuery<Row>(db, graph, "read/questions", { projectId });
  return rows.map(toView);
}

export function questionsRouter(deps: { db: () => Promise<FalkorDB>; events: Events }): Router {
  const router = express.Router();

  // 8. GET /api/projects/:id/questions (snapshot)
  router.get("/projects/:id/questions", async (req, res) => {
    const db = await deps.db();
    const found = await pathProject(db, req.params.id);
    if (!found.ok) return sendError(res, found.error);
    const seq = deps.events.current(found.id); // read before the snapshot (C12)
    res.json({ questions: await readViews(db, found.graph, found.id), seq });
  });

  // 9. POST /api/questions/:id/answer. Guards: tenancy, version. Accepting the recommendation
  // confirms the Assumption and stores the recommended text as the answer (P); an own answer
  // rejects it.
  router.post("/questions/:id/answer", async (req, res) => {
    const body = parseBody(AnswerBody, req.body);
    if (!body.ok) return sendError(res, body.error);
    const actor = personActor(req);
    if (!actor) return sendError(res, MISSING_ACTOR);
    const db = await deps.db();
    const at = { events: deps.events, tool: ANSWER, agent: actor };
    const found = await headerNode(db, req, "Question", at);
    if (!found.ok) return sendError(res, found.error);
    const { projectId, graph, props } = found;

    const stale = version(body.data.version, Number(props.version));
    if (stale) return sendError(res, await rejectAndCount(db, projectId, stale, at));
    if (props.status !== "open") {
      return sendError(res, {
        code: "VALIDATION_FAILED",
        reason: "This question is answered already.",
      });
    }

    const written = await answerQuestion(
      { db, graph, projectId },
      {
        questionId: String(props.id),
        version: body.data.version,
        text: body.data.accept ? String(props.recommended) : body.data.text!,
        accepted: body.data.accept,
        createdBy: actor,
        now: Date.now(),
      },
    );
    if (!written) {
      // Answered on another screen between the read and the write; the write checked it again.
      const [now] = await readQuery<{ n: { properties: Props } }>(db, graph, "read/node", {
        id: String(props.id),
      });
      const refused =
        version(body.data.version, Number(now?.n.properties.version)) ??
        reject("version", "VERSION_OLD", "The question changed while it was being answered.");
      return sendError(res, await rejectAndCount(db, projectId, refused, at));
    }

    const emit = (label: NodeLabel, id: string, v: number, summary: string) =>
      deps.events.emit(projectId, "node.written", { label, id, version: v, summary });
    emit("Episode", written.episodeId, 1, "Answer");
    emit("Question", String(props.id), written.questionVersion, "Question answered");
    emit(
      "Assumption",
      written.assumptionId,
      written.assumptionVersion,
      body.data.accept ? "Assumption confirmed" : "Assumption rejected",
    );
    if (written.contradictionId) {
      emit(
        "Contradiction",
        written.contradictionId,
        written.contradictionVersion!,
        "Contradiction resolved",
      );
    }
    const opened = await runStage(db, deps.events, projectId, {
      type: "question_answered",
      episodeId: written.episodeId,
      actor,
    });
    const item = opened.find((o) => o.kind === "intake_answer");
    if (!item) throw new Error(`no intake_answer item opened for answer ${written.episodeId}`);

    const question = (await readViews(db, graph, projectId)).find((q) => q.id === props.id)!;
    res.json({
      question,
      assumption: question.assumption,
      episodeId: written.episodeId,
      workItemId: item.id,
    });
  });

  return router;
}
