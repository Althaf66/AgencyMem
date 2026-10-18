// stage-machine.md section 9: the persona plays every human of a demo project through the REST
// routes, so every guard still applies. Answers come from the model (agent-prompts.md section 12);
// gates, change requests, the bug report and actual hours are rule-based.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AnswerResponse,
  BoardResponse,
  ChangeRequestResponse,
  CloseProjectResponse,
  CreateProjectResponse,
  FeaturesResponse,
  GateDecisionResponse,
  type GateDecisionBody,
  GatesResponse,
  GetProjectResponse,
  QuestionsResponse,
  ReadinessResponse,
  UploadFilesResponse,
  type FixtureSet,
  type GateKey,
  type QuestionView,
  TruthSheet,
} from "@agencymem/contracts";
import type { ModelClient } from "@agencymem/llm";
import { z } from "zod";
import { actualHours, type Sim } from "./actual-hours";

const POLL_MS = 2000;
const FILES = ["kickoff-notes.pdf", "client-summary.docx", "whatsapp-chat.txt"];

type Decision = Omit<z.input<typeof GateDecisionBody>, "version">;

/** `decided` counts this persona's earlier decisions on the gate. */
export function gateDecision(key: GateKey, decided: number): Decision {
  if (key === "G2" && decided === 0)
    return { decision: "reject", reason: "estimate too high, cut scope" };
  return { decision: "approve" };
}

/** How many of `n` change requests are due: CR i goes out once `done` reaches ceil(i × total ÷ (n + 1)). */
export function crsDue(n: number, total: number, done: number): number {
  let due = 0;
  while (due < n && done >= Math.ceil(((due + 1) * total) / (n + 1))) due++;
  return due;
}

const PersonaAnswer = z.object({
  accept: z.boolean(),
  text: z.string().max(2000).optional(),
  plantedId: z.string().optional(), // for logs only
});

const ANSWER_PROMPT = `You play the client of a software agency. Answer only from TRUTH.
For the QUESTION, decide whether RECOMMENDED means the same as what TRUTH says.
- Same meaning: accept.
- Different: do not accept, and write the answer TRUTH gives, in one or two plain
  sentences, as a client would say it.
- TRUTH does not cover the question: accept.
Never mention TRUTH, the simulation, or any hidden numbers.`;

async function answer(llm: ModelClient, truth: TruthSheet, q: QuestionView) {
  const { output } = await llm.json({
    tier: "thin",
    system: ANSWER_PROMPT,
    user: [
      `CONTEXT: TRUTH ${JSON.stringify({ rules: truth.rules, answers: truth.answers })}`,
      `CONTEXT: QUESTION ${JSON.stringify({
        text: q.text,
        kind: q.kind,
        recommended: q.recommended,
        sources: q.sources.map((s) => ({ document: s.documentName, text: s.text })),
      })}`,
      "TASK: Return { accept, text?, plantedId? }.",
    ].join("\n"),
    schema: PersonaAnswer,
    check: (a) => (a.accept || a.text ? [] : ["text is required when accept is false"]),
    maxTokens: 400,
  });
  return output;
}

export type Gateway = { url: string; token: string };

class GatewayError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Routes with no project id in the path (9, 11) find the project by X-AM-Project (contracts.md).
export function client(gw: Gateway, actor: string, project?: string) {
  return async <T>(
    schema: z.ZodType<T>,
    path: string,
    init: RequestInit & { json?: unknown } = {},
  ) => {
    const { json, ...rest } = init;
    const res = await fetch(`${gw.url}${path}`, {
      ...rest,
      ...(json === undefined ? {} : { method: "POST", body: JSON.stringify(json) }),
      headers: {
        "X-AM-Token": gw.token,
        "X-AM-Actor": actor,
        ...(project === undefined ? {} : { "X-AM-Project": project }),
        ...(json === undefined ? {} : { "Content-Type": "application/json" }),
      },
    });
    if (!res.ok)
      throw new GatewayError(
        res.status,
        `${rest.method ?? (json ? "POST" : "GET")} ${path}: ${res.status} ${await res.text()}`,
      );
    return schema.parse(await res.json());
  };
}

export type ProjectRun = {
  gw: Gateway;
  llm: ModelClient;
  fixtures: string;
  set: FixtureSet;
  sim: Sim;
  liveDemo: boolean;
  /** Called with the project id at once, then whenever crsSent or actuals change. */
  save: (projectId: string, patch: { crsSent?: number; actuals?: unknown }) => Promise<void>;
};

/** Runs one demo project to closed (or, for the live demo, until Launch has written its report). */
export async function runProject(run: ProjectRun): Promise<string> {
  const { gw, llm, set, sim, liveDemo } = run;
  const dir = join(run.fixtures, set);
  const truth = TruthSheet.parse(JSON.parse(await readFile(join(dir, "truth.json"), "utf8")));

  // Decision 13 (P): no project id exists yet, so creation uses persona:sim.
  const { project } = await client(gw, "persona:sim")(CreateProjectResponse, "/api/projects", {
    // Route 1 finds a Client by name; the live demo is set A again as a new client (fixtures.md).
    json: {
      clientName: liveDemo ? `${truth.client.name} (live demo)` : truth.client.name,
      projectName: "Clinic booking app",
      mode: "demo",
    },
  });
  const id = project.id;
  const api = client(gw, `persona:${id}`, id);
  await run.save(id, {});
  console.log(`[${set}] project ${id}`);

  const form = new FormData();
  for (const name of FILES) form.append("files", new Blob([await readFile(join(dir, name))]), name);
  await api(UploadFilesResponse, `/api/projects/${id}/files`, { method: "POST", body: form });

  const decided = new Map<string, number>(); // gate key -> this persona's decisions so far
  const crTarget = liveDemo ? 0 : sim.changeRequests;
  let crsSent = 0;
  let closed = false;
  let stage = project.stage;

  for (;;) {
    try {
      const now = (await api(GetProjectResponse, `/api/projects/${id}`)).project.stage;
      if (now !== stage) console.log(`[${set}] stage ${stage} -> ${now}`);
      stage = now;
      if (stage === "closed") return id;

      for (const q of (await api(QuestionsResponse, `/api/projects/${id}/questions`)).questions) {
        if (q.status !== "open") continue;
        const a = await answer(llm, truth, q);
        await api(AnswerResponse, `/api/questions/${q.id}/answer`, {
          json: { version: q.version, accept: a.accept, ...(a.accept ? {} : { text: a.text }) },
        });
        console.log(
          `[${set}] answered ${q.id} (${a.accept ? "accept" : "own answer"}${a.plantedId ? `, ${a.plantedId}` : ""})`,
        );
      }

      for (const g of (await api(GatesResponse, `/api/projects/${id}/gates`)).gates) {
        if (g.status !== "waiting" || !g.canDecide) continue;
        const d = gateDecision(g.key, decided.get(g.key) ?? 0);
        await api(GateDecisionResponse, `/api/gates/${g.id}/decision`, {
          json: { version: g.version, ...d },
        });
        decided.set(g.key, (decided.get(g.key) ?? 0) + 1);
        console.log(`[${set}] ${g.key} ${d.decision}`);
      }

      if (!closed) {
        const { cards } = await api(BoardResponse, `/api/projects/${id}/board`);
        const build = cards.filter((c) => c.kind === "build");
        const done = build.filter((c) => c.column === "Done").length;
        const due = build.length ? crsDue(crTarget, build.length, done) : 0;
        for (; crsSent < due; crsSent++) {
          const text = truth.lateChanges[crsSent]?.text;
          if (!text) break;
          await api(ChangeRequestResponse, `/api/projects/${id}/change-requests`, {
            json: { text },
          });
          await run.save(id, { crsSent: crsSent + 1 });
          console.log(`[${set}] change request ${crsSent + 1} of ${crTarget}`);
        }

        // T28: close once Launch wrote its report; a run still checking answers 409, tried again.
        const report =
          stage === "launch"
            ? (await api(ReadinessResponse, `/api/projects/${id}/readiness`)).report
            : null;
        if (report && liveDemo) {
          console.log(`[${set}] launch is ready; the presenter takes over`);
          return id;
        }
        if (report) {
          const { features } = await api(FeaturesResponse, `/api/projects/${id}/features`);
          const actuals = actualHours(
            features.map((f) => ({
              id: f.id,
              featureKind: f.featureKind,
              rawHours: f.estimate.rawHours,
            })),
            sim,
          );
          const override = report.passed ? {} : { override: true, reason: "demo run" };
          await api(CloseProjectResponse, `/api/projects/${id}/close`, {
            json: { actuals, ...override },
          });
          await run.save(id, { actuals });
          closed = true;
          console.log(`[${set}] close sent with ${actuals.length} actuals`);
        }
      }
    } catch (e) {
      // A bad token or body never clears; a stale version or a busy route is retried next poll.
      if (e instanceof GatewayError && (e.status === 400 || e.status === 401)) throw e;
      console.error(`[${set}] ${e instanceof Error ? e.message : String(e)}`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
