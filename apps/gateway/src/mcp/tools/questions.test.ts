// write_question, recall_context for discovery, route 8 (questions) and the project's clarity,
// through the real gateway against the real FalkorDB from docker-compose.yml. No mocks.
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  loadConfig,
  type Envelope,
  type ProjectInfo,
  type QuestionView,
} from "@agencymem/contracts";
import { REGISTRY_GRAPH, close, connect, readQuery, type FalkorDB } from "@agencymem/graph";
import {
  createProject,
  openItem,
  writeDocument,
  writeFacts,
  type Ctx,
  deleteTestClient,
} from "@agencymem/memory";
import { createEvents } from "../../events/bus";
import { createGateway } from "../../main";

const TOKENS = { AM_AGENT_TOKEN: "agent-t", AM_UI_TOKEN: "ui-t", AM_HOOK_TOKEN: "hook-t" };
const FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";
// Built at run time, so this file holds no Cypher string literal (AGENTS.md rule 4).
const q = (...parts: string[]) => parts.join(" ");

let db: FalkorDB;
let server: Server;
let base: string;
const events = createEvents();
const graphs = new Set<string>();
const clients: Client[] = [];

beforeAll(async () => {
  db = await connect(FALKORDB_URL);
  server = createGateway(loadConfig({ ...TOKENS, FALKORDB_URL }, "gateway"), { events });
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

const entity = (key: string) => ({ key, name: key, aliases: [] });

/**
 * A project with two documents' worth of facts: F1 (kickoff, line 4) says 20 minutes, F2 (summary,
 * line 9) says 30, F3 (kickoff, line 4 too) was replaced by F4, and a discovery item.
 */
async function setup() {
  const { project, client } = await createProject(db, {
    clientName: `test-client-${randomUUID()}`,
    projectName: "Questions",
    mode: "demo",
    createdBy: "human:test",
    now: Date.now(),
  });
  const ctx: Ctx = { db, graph: `client_${client.id}`, projectId: project.id };
  graphs.add(ctx.graph);
  const doc = (name: string, line: number, text: string, sha: string) =>
    writeDocument(ctx, {
      name,
      mime: "text/plain",
      sha256: sha.repeat(64),
      status: "processed",
      wordCount: 10,
      error: null,
      episodes: [{ page: 1, lineStart: line, lineEnd: line, text }],
      createdBy: "human:test",
      now: Date.now(),
    });
  const kickoff = await doc(
    "kickoff-notes.pdf",
    4,
    "Each appointment slot is 20 minutes long.",
    "c",
  );
  const summary = await doc(
    "client-summary.docx",
    9,
    "Appointments are booked in 30-minute slots.",
    "d",
  );
  const [E1, E2] = [kickoff.episodeIds[0]!, summary.episodeIds[0]!];
  const fact = (value: string, episodeIds: string[]) => ({
    statement: `A slot is ${value} minutes long.`,
    subject: "appointment-slot",
    attribute: "length_minutes",
    value,
    episodeIds,
    replacesFactId: null as string | null,
  });
  const write = (facts: ReturnType<typeof fact>[]) =>
    writeFacts(ctx, {
      entities: [entity("appointment-slot")],
      facts,
      createdBy: "intake",
      now: Date.now(),
    });
  const { factIds } = await write([fact("20", [E1]), fact("30", [E2]), fact("25", [E1])]);
  const [F1, F2, F3] = factIds as [string, string, string];
  const later = await write([{ ...fact("15", [E1]), replacesFactId: F3 }]);
  const F4 = later.factIds[0]!;
  const item = (await openItem(ctx, {
    kind: "discovery",
    subjectId: null,
    createdBy: "intake",
    now: Date.now(),
  }))!;
  return { ctx, E1, E2, F1, F2, F3, F4, item };
}

async function agent(projectId: string, agentId = "discovery", worker = "discovery-1") {
  const client = new Client({ name: "test", version: "0" });
  const headers = {
    "X-AM-Token": "agent-t",
    "X-AM-Agent": agentId,
    "X-AM-Project": projectId,
    "X-AM-Worker": worker,
  };
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }),
  );
  clients.push(client);
  return client;
}

type Result = { isError?: boolean; structuredContent?: Record<string, unknown> };
async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as Result;
  return { isError: result.isError === true, out: result.structuredContent ?? {} };
}
const reasonCode = (out: Record<string, unknown>) =>
  (out.error as { details?: { reasonCode?: string } }).details?.reasonCode;
const rows = (ctx: Ctx, cypher: string) =>
  db
    .selectGraph(ctx.graph)
    .roQuery(cypher)
    .then((r) => (r.data ?? []) as Record<string, unknown>[]);
const ui = { "X-AM-Token": "ui-t" };

const question = (kind: string, factIds: string[], extra: Record<string, unknown> = {}) => ({
  kind,
  text: `Is this a ${kind} question?`,
  recommended: "20 minutes.",
  reasoning: "The kickoff notes say 20 minutes.",
  assumption: "An appointment slot is 20 minutes long.",
  approach: "The calendar shows 20-minute slots.",
  factIds,
  ...extra,
});
const contradiction = (factIds: string[]) =>
  question("contradiction", factIds, {
    contradiction: { summary: "Slot length is 20 minutes in the kickoff and 30 in the summary." },
  });

describe("write_question", () => {
  it("writes each Question with its Assumption, and a Contradiction BETWEEN its facts", async () => {
    const { ctx, F1, F2, item } = await setup();
    const discovery = await agent(ctx.projectId);
    const sent: Envelope[] = [];
    const off = events.on((e) => e.projectId === ctx.projectId && sent.push(e));
    const res = await call(discovery, "write_question", {
      itemId: item.id,
      questions: [contradiction([F1, F2]), question("unclear", [F1]), question("open", [F2])],
    });
    off();
    expect(res.isError).toBe(false);
    const out = res.out as Record<string, string[]>;
    expect([
      out.questionIds?.length,
      out.contradictionIds?.length,
      out.assumptionIds?.length,
    ]).toEqual([3, 1, 3]);

    const questions = await rows(
      ctx,
      q(
        "MATCH",
        "(x:Question)-[:ASSUMES]->(a:Assumption)",
        "RETURN",
        "x.kind AS kind, x.status AS status, a.status AS assumption ORDER BY kind",
      ),
    );
    expect(questions).toEqual([
      { kind: "contradiction", status: "open", assumption: "open" },
      { kind: "open", status: "open", assumption: "open" },
      { kind: "unclear", status: "open", assumption: "open" },
    ]);
    const between = await rows(
      ctx,
      q(
        "MATCH",
        "(x:Question)-[:RAISED_ON]->(c:Contradiction)-[:BETWEEN]->(f:Fact)",
        "RETURN",
        "c.status AS status, f.id AS fact ORDER BY fact",
      ),
    );
    expect(between).toEqual([F1, F2].sort().map((fact) => ({ status: "open", fact })));
    const raised = await rows(
      ctx,
      q(
        "MATCH",
        "(x:Question)-[:RAISED_ON]->(f:Fact)",
        "RETURN",
        "x.kind AS kind, f.id AS fact ORDER BY kind",
      ),
    );
    expect(raised).toEqual([
      { kind: "open", fact: F2 },
      { kind: "unclear", fact: F1 },
    ]);
    expect(sent.map((e) => (e.data as { label?: string }).label)).toEqual([
      "Question",
      "Contradiction",
      "Assumption",
    ]);
  });

  it("refuses a fact that is not current or does not exist (source, counted)", async () => {
    const { ctx, F1, F3, item } = await setup();
    const discovery = await agent(ctx.projectId);
    const ended = await call(discovery, "write_question", {
      itemId: item.id,
      questions: [question("unclear", [F3])],
    });
    expect(reasonCode(ended.out)).toBe("SOURCE_UNKNOWN");
    const unknown = await call(discovery, "write_question", {
      itemId: item.id,
      questions: [question("unclear", [F1, "01ARZ3NDEKTSV4RRFFQ69G5FAV"])],
    });
    expect(reasonCode(unknown.out)).toBe("SOURCE_UNKNOWN");
    // Both rejections are counted as rejected writes (AGENTS.md rule 8).
    const [project] = await readQuery<{ p: { properties: { rejectedWrites: number } } }>(
      db,
      REGISTRY_GRAPH,
      "read/project",
      { projectId: ctx.projectId },
    );
    expect(project!.p.properties.rejectedWrites).toBe(2);
    expect(await rows(ctx, q("MATCH", "(x:Question)", "RETURN", "count(x) AS n"))).toEqual([
      { n: 0 },
    ]);
  });

  it("refuses a contradiction that names one fact twice, even a fact with two episodes", async () => {
    const { ctx, E1, E2, item } = await setup();
    const both = await writeFacts(ctx, {
      entities: [entity("appointment-slot")],
      facts: [
        {
          statement: "A slot is 20 minutes long.",
          subject: "appointment-slot",
          attribute: "length_minutes",
          value: "20 min",
          episodeIds: [E1, E2],
          replacesFactId: null,
        },
      ],
      createdBy: "intake",
      now: Date.now(),
    });
    const F = both.factIds[0]!;
    const discovery = await agent(ctx.projectId);
    const res = await call(discovery, "write_question", {
      itemId: item.id,
      questions: [contradiction([F, F])],
    });
    expect(res.out).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });

  it("refuses a contradiction whose facts come from one episode", async () => {
    const { ctx, F1, F4, item } = await setup();
    const discovery = await agent(ctx.projectId);
    const res = await call(discovery, "write_question", {
      itemId: item.id,
      questions: [contradiction([F1, F4])],
    });
    expect(res.out).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });

  it("refuses another agent (ownership) and writes nothing for zero questions", async () => {
    const { ctx, F1, item } = await setup();
    const intake = await agent(ctx.projectId, "intake", "intake-1");
    const refused = await call(intake, "write_question", {
      itemId: item.id,
      questions: [question("unclear", [F1])],
    });
    expect(reasonCode(refused.out)).toBe("LABEL_NOT_OWNED");
    const discovery = await agent(ctx.projectId);
    const none = await call(discovery, "write_question", { itemId: item.id, questions: [] });
    expect(none.out).toEqual({ questionIds: [], contradictionIds: [], assumptionIds: [] });
  });
});

describe("recall_context for a discovery item", () => {
  it("gives the current facts with their episodes, the entities and the documents", async () => {
    const { ctx, E1, E2, F1, F2, F4, item } = await setup();
    const discovery = await agent(ctx.projectId);
    const res = await call(discovery, "recall_context", { itemId: item.id });
    const context = (res.out as { context: Record<string, unknown> }).context;
    const facts = context.facts as {
      id: string;
      value: string;
      episodeIds: string[];
      validTo: null;
      replacedBy: null;
    }[];
    expect(facts.map((f) => [f.id, f.value, f.episodeIds, f.validTo, f.replacedBy]).sort()).toEqual(
      [
        [F1, "20", [E1], null, null],
        [F2, "30", [E2], null, null],
        [F4, "15", [E1], null, null],
      ].sort(),
    );
    expect(context.entities).toEqual([
      { key: "appointment-slot", name: "appointment-slot", aliases: [] },
    ]);
    expect(
      (context.documents as { name: string; wordCount: number }[])
        .map((d) => [d.name, d.wordCount])
        .sort(),
    ).toEqual([
      ["client-summary.docx", 10],
      ["kickoff-notes.pdf", 10],
    ]);
  });
});

describe("GET /api/projects/:id/questions (route 8) and the project's clarity", () => {
  it("lists contradictions first, each with its source lines, and the seq", async () => {
    const { ctx, E1, E2, F1, F2, item } = await setup();
    const discovery = await agent(ctx.projectId);
    await call(discovery, "write_question", {
      itemId: item.id,
      questions: [question("unclear", [F1]), contradiction([F1, F2])],
    });
    const res = await fetch(`${base}/api/projects/${ctx.projectId}/questions`, { headers: ui });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { questions: QuestionView[]; seq: number };
    expect(body.seq).toBe(events.current(ctx.projectId));
    expect(body.questions.map((x) => x.kind)).toEqual(["contradiction", "unclear"]);
    const [first, second] = body.questions as [QuestionView, QuestionView];
    expect(first).toMatchObject({
      status: "open",
      version: 1,
      assumption: { text: "An appointment slot is 20 minutes long.", status: "open" },
      contradiction: { status: "open" },
      answer: null,
    });
    expect(
      first.sources
        .map((s) => [s.factId, s.episodeId, s.documentName, s.page, s.lineStart, s.text])
        .sort(),
    ).toEqual(
      [
        [F1, E1, "kickoff-notes.pdf", 1, 4, "Each appointment slot is 20 minutes long."],
        [F2, E2, "client-summary.docx", 1, 9, "Appointments are booked in 30-minute slots."],
      ].sort(),
    );
    expect(second.contradiction).toBeNull();
    expect(second.sources.map((s) => s.episodeId)).toEqual([E1]);
  });

  it("gives the clarity only once Discovery is done: density and band", async () => {
    const { ctx, F1, F2, item } = await setup();
    const project = async () => {
      const res = await fetch(`${base}/api/projects/${ctx.projectId}`, { headers: ui });
      return ((await res.json()) as { project: ProjectInfo }).project;
    };
    const discovery = await agent(ctx.projectId);
    await call(discovery, "claim_item", { itemId: item.id });
    await call(discovery, "write_question", {
      itemId: item.id,
      questions: [contradiction([F1, F2]), question("unclear", [F1]), question("open", [F2])],
    });
    expect((await project()).clarity).toBeNull();
    await call(discovery, "complete_item", { itemId: item.id, outcome: "done", runs: [] });
    // (1 contradiction + 1 unclear) per 1,000 words of the two 10-word documents.
    expect((await project()).clarity).toEqual({ density: 100, band: "low" });
  });
});
