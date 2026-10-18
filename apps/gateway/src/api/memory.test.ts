// GET /api/projects/:id/memory through the real gateway against the real FalkorDB from
// docker-compose.yml: a file, a question, its answer and a change request come back as turns in
// time order, and the superseded fact keeps its validTo. No mocks.
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AskResponse, MemoryResponse, loadConfig } from "@agencymem/contracts";
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
const clients: Client[] = [];

beforeAll(async () => {
  db = await connect(FALKORDB_URL);
  server = createGateway(loadConfig({ ...TOKENS, FALKORDB_URL }, "gateway"), {
    events: createEvents(),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await Promise.allSettled(clients.map((c) => c.close()));
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  for (const graph of graphs) await deleteTestClient(db, graph);
  await close();
});

/** An MCP session as the Discovery agent's ask loop. */
async function discovery(projectId: string): Promise<Client> {
  const client = new Client({ name: "test", version: "0" });
  const headers = {
    "X-AM-Token": "agent-t",
    "X-AM-Agent": "discovery",
    "X-AM-Project": projectId,
    "X-AM-Worker": "discovery-2",
  };
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }),
  );
  clients.push(client);
  return client;
}
async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
  };
  expect(result.isError ?? false).toBe(false);
  return result.structuredContent as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}
async function ask(projectId: string, text: string) {
  const res = await fetch(`${base}/api/projects/${projectId}/ask`, {
    method: "POST",
    headers: { ...ui, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  expect(res.status).toBe(201);
  return AskResponse.parse(await res.json());
}

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

  it("asks the project: Discovery recalls the question and the thread, and the reply cites facts", async () => {
    const { project, client } = await createProject(db, {
      clientName: `test-client-${randomUUID()}`,
      projectName: "Ask",
      mode: "demo",
      createdBy: "human:test",
      now: Date.now(),
    });
    const ctx: Ctx = { db, graph: `client_${client.id}`, projectId: project.id };
    graphs.add(ctx.graph);
    const { episodeIds } = await writeDocument(ctx, {
      name: "notes.md",
      mime: "text/markdown",
      sha256: "f".repeat(64),
      status: "processed",
      wordCount: 4,
      error: null,
      episodes: [{ page: 1, lineStart: 1, lineEnd: 1, text: "Open at 9." }],
      createdBy: "human:test",
      now: Date.now(),
    });
    const { factIds } = await writeFacts(ctx, {
      entities: [{ key: "shop", name: "Shop", aliases: [] }],
      facts: [
        {
          statement: "The shop opens at 9.",
          subject: "shop",
          attribute: "opens",
          value: "9",
          episodeIds,
          replacesFactId: null,
        },
      ],
      createdBy: "intake",
      now: Date.now(),
    });
    const agent = await discovery(project.id);

    const first = await ask(project.id, "When does the shop open?");
    const claimed = await call(agent, "claim_item", { kinds: ["ask"] });
    expect(claimed.item.id).toBe(first.workItemId);
    const recall = await call(agent, "recall_context", { itemId: first.workItemId });
    expect(recall.context.ask).toEqual({ question: "When does the shop open?", earlier: [] });
    expect(recall.context.facts.map((f: { id: string }) => f.id)).toEqual(factIds);
    await call(agent, "write_handoff", {
      itemId: first.workItemId,
      summary: "At 9.",
      outputIds: factIds,
    });
    await call(agent, "complete_item", { itemId: first.workItemId, outcome: "done", runs: [] });

    // The follow-up reads the first question and its answer; an ask's handoff is not every agent's.
    const second = await ask(project.id, "And on Sunday?");
    await call(agent, "claim_item", { kinds: ["ask"] });
    const again = await call(agent, "recall_context", { itemId: second.workItemId });
    expect(again.context.ask.question).toBe("And on Sunday?");
    expect(again.context.ask.earlier).toMatchObject([
      { question: "When does the shop open?", answer: "At 9." },
    ]);
    expect(again.context.handoffs).toEqual([]);

    const res = await fetch(`${base}/api/projects/${project.id}/memory`, { headers: ui });
    const body = MemoryResponse.parse(await res.json());
    const chat = body.turns.filter((t) => t.kind === "ask" || t.kind === "reply");
    expect(chat.map((t) => [t.kind, t.text, t.refId, t.sourceIds])).toEqual([
      ["ask", "When does the shop open?", null, []],
      ["reply", "At 9.", first.episodeId, factIds],
      ["ask", "And on Sunday?", null, []],
    ]);
  });

  it("refuses an empty question (400) and one without an actor", async () => {
    const { project, client } = await createProject(db, {
      clientName: `test-client-${randomUUID()}`,
      projectName: "Ask refused",
      mode: "demo",
      createdBy: "human:test",
      now: Date.now(),
    });
    graphs.add(`client_${client.id}`);
    const post = (headers: Record<string, string>, text: string) =>
      fetch(`${base}/api/projects/${project.id}/ask`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
    expect((await post(ui, "  ")).status).toBe(400);
    expect((await post({ "X-AM-Token": "ui-t" }, "Why?")).status).not.toBe(201);
  });

  it("answers 404 for an unknown project", async () => {
    const res = await fetch(`${base}/api/projects/01ARZ3NDEKTSV4RRFFQ69G5FAV/memory`, {
      headers: ui,
    });
    expect(res.status).toBe(404);
  });
});
