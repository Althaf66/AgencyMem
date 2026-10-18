// GET /api/projects/:id/memory through the real gateway against the real FalkorDB from
// docker-compose.yml: a file, a question, its answer and a change request come back as turns in
// time order, and the superseded fact keeps its validTo. No mocks.
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryResponse, loadConfig } from "@agencymem/contracts";
import { close, connect, type FalkorDB } from "@agencymem/graph";
import {
  answerQuestion,
  createChangeRequest,
  createProject,
  deleteTestClient,
  supersedeFacts,
  writeDocument,
  writeFacts,
  writeQuestions,
  type Ctx,
} from "@agencymem/memory";
import { createEvents } from "../events/bus";
import { createGateway } from "../main";

const TOKENS = { AM_AGENT_TOKEN: "agent-t", AM_UI_TOKEN: "ui-t", AM_HOOK_TOKEN: "hook-t" };
const FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";
const ui = { "X-AM-Token": "ui-t", "X-AM-Actor": "human:ana" };

let db: FalkorDB;
let server: Server;
let base: string;
const graphs = new Set<string>();

beforeAll(async () => {
  db = await connect(FALKORDB_URL);
  server = createGateway(loadConfig({ ...TOKENS, FALKORDB_URL }, "gateway"), {
    events: createEvents(),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  for (const graph of graphs) await deleteTestClient(db, graph);
  await close();
});

describe("GET /api/projects/:id/memory", () => {
  it("lists the turns in time order with their facts, and keeps the ended fact", async () => {
    const t = 1_700_000_000_000;
    const { project, client } = await createProject(db, {
      clientName: `test-client-${randomUUID()}`,
      projectName: "Memory",
      mode: "demo",
      createdBy: "human:test",
      now: t,
    });
    const ctx: Ctx = { db, graph: `client_${client.id}`, projectId: project.id };
    graphs.add(ctx.graph);
    const { episodeIds } = await writeDocument(ctx, {
      name: "kickoff-notes.pdf",
      mime: "application/pdf",
      sha256: "e".repeat(64),
      status: "processed",
      wordCount: 10,
      error: null,
      episodes: [
        { page: 1, lineStart: 1, lineEnd: 2, text: "Open at 9." },
        { page: 1, lineStart: 3, lineEnd: 4, text: "Close at 5." },
      ],
      createdBy: "human:test",
      now: t + 1,
    });
    const { factIds } = await writeFacts(ctx, {
      entities: [{ key: "shop", name: "Shop", aliases: [] }],
      facts: [
        // sourced from both lines: counts once
        { statement: "The shop opens at 9.", attribute: "opens", value: "9", episodeIds },
        { statement: "The shop closes at 5.", attribute: "closes", value: "5", episodeIds },
      ].map((f) => ({ ...f, subject: "shop", replacesFactId: null })),
      createdBy: "intake",
      now: t + 2,
    });
    const { questionIds } = await writeQuestions(ctx, {
      questions: [
        {
          kind: "open",
          text: "Is the shop open on Sunday?",
          recommended: "Closed on Sunday.",
          reasoning: "The notes say nothing.",
          approach: "Ask the client.",
          assumption: "Closed on Sunday.",
          factIds: [factIds[0]!],
          contradiction: null,
        },
      ],
      createdBy: "discovery",
      now: t + 3,
    });
    await answerQuestion(ctx, {
      questionId: questionIds[0]!,
      version: 1,
      text: "Closed on Sunday.",
      accepted: true,
      createdBy: "human:test",
      now: t + 4,
    });
    const { changeRequest } = await createChangeRequest(ctx, {
      text: "Open at 10 instead.",
      createdBy: "human:test",
      now: t + 5,
    });
    await supersedeFacts(ctx, {
      crId: changeRequest.id,
      status: "applied",
      changes: [{ oldFactId: factIds[0]!, statement: "The shop opens at 10.", value: "10" }],
      createdBy: "proposal",
      now: t + 6,
    });

    const res = await fetch(`${base}/api/projects/${project.id}/memory`, { headers: ui });
    expect(res.status).toBe(200);
    const body = MemoryResponse.parse(await res.json());
    expect(body.turns.map((x) => [x.kind, x.facts, x.ended])).toEqual([
      ["document", 2, 0],
      ["question", 0, 0],
      ["answer", 0, 0],
      ["change_request", 1, 1],
    ]);
    expect(body.turns[2]!.refId).toBe(questionIds[0]);
    expect(body.turns[3]!.text).toBe("CR-1: Open at 10 instead.");
    const old = body.facts.find((f) => f.id === factIds[0]);
    expect(old).toMatchObject({ validFrom: t + 2, validTo: t + 6 });
    expect(body.facts.filter((f) => f.validTo === null)).toHaveLength(2);
  });

  it("answers 404 for an unknown project", async () => {
    const res = await fetch(`${base}/api/projects/01ARZ3NDEKTSV4RRFFQ69G5FAV/memory`, {
      headers: ui,
    });
    expect(res.status).toBe(404);
  });
});
