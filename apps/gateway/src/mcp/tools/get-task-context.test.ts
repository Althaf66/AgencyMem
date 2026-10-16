// Task 4.7, Done when: the result stays within CONTEXT_MAX_CHARS. get_task_context (contracts.md
// section 7): fitContext's cut order on synthetic data, then the tool through the real gateway
// against the real FalkorDB from docker-compose.yml. No mocks.
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type ToolOutput } from "@agencymem/contracts";
import { REGISTRY_GRAPH, close, connect, readQuery, type FalkorDB } from "@agencymem/graph";
import {
  createProject,
  deleteTestClient,
  setStage,
  writeCards,
  writeDesign,
  writeDocument,
  writeFacts,
  writeProduct,
  writeTests,
} from "@agencymem/memory";
import { createGateway } from "../../main";
import { fitContext } from "./get-task-context";

type Out = ToolOutput<"get_task_context">;
const ID = "01JA0000000000000000000010";

/** A context with every part filled, in the shape the tool builds before it cuts. */
function big(): Out {
  const long = (n: number) => "x".repeat(n);
  return {
    task: {
      id: ID,
      key: "CARD-01",
      title: "Card",
      description: long(1000),
      lane: "Backend",
      kind: "build",
      version: 3,
      branch: "card/CARD-01",
      note: null,
    },
    requirement: { key: "REQ-01", text: "R", facts: [{ id: ID, statement: "F" }] },
    criteria: [{ key: "AC-01-1", text: long(250), testIds: ["book-submit"] }],
    design: [1, 2].map((i) => ({
      label: "Endpoint" as const,
      key: `EP-0${i}`,
      name: "E",
      body: long(1500),
      method: "POST",
      path: "/api/x",
    })),
    testCases: [
      { file: "tests/e2e/CARD-01/AC-01-1.spec.ts", title: "AC-01-1: t", criterionKey: "AC-01-1" },
    ],
    codeChanges: [1, 2, 3].map((i) => ({
      sha: String(i).repeat(40),
      message: long(400),
      files: ["a.ts"],
      committedAt: i,
    })),
    episodes: [1, 2, 3, 4].map((i) => ({
      documentName: "notes.pdf",
      page: 1,
      lineStart: i,
      lineEnd: i,
      excerpt: `${i}${long(1999)}`,
    })),
    defect: null,
    conventions: { testIdRule: "r", stack: "s" },
    truncated: false,
    chars: 0,
  };
}
const size = (out: Out) => JSON.stringify(out).length;

describe("fitContext (contracts.md section 7: the cut order)", () => {
  it("leaves a context that fits as it is, with its size", () => {
    const out = fitContext(big(), 100_000);
    expect(out.truncated).toBe(false);
    expect(out.episodes.map((e) => e.excerpt.length)).toEqual([2000, 2000, 2000, 2000]);
    expect(out.chars).toBe(size(out));
  });

  it("cuts excerpts to 300 first, then drops episodes from the oldest, then code changes, then design bodies", () => {
    const full = size(big());
    const excerptsCut = fitContext(big(), full - 1000);
    expect(excerptsCut.episodes.map((e) => e.excerpt.length)).toEqual([300, 300, 300, 300]);
    expect(excerptsCut.codeChanges).toHaveLength(3);

    const episodesGone = fitContext(big(), full - 8_000);
    expect(episodesGone.episodes.length).toBeLessThan(4);
    // The oldest (first) episodes go first.
    const left = episodesGone.episodes.length;
    expect(episodesGone.episodes.map((e) => e.lineStart)).toEqual([1, 2, 3, 4].slice(4 - left));

    // Every episode gone, then one code change: the oldest goes, the newest stay.
    const noEpisodes = JSON.stringify({ ...big(), episodes: [], truncated: true, chars: 99_999 });
    const someChanges = fitContext(big(), noEpisodes.length - 100);
    expect(someChanges.episodes).toEqual([]);
    expect(someChanges.codeChanges.map((c) => c.committedAt)).toEqual([2, 3]);

    const tight = fitContext(big(), 3_000);
    expect(tight.episodes).toEqual([]);
    expect(tight.codeChanges).toEqual([]);
    expect(tight.design.map((n) => n.body.length)).toEqual([300, 300]);
    expect(tight.truncated).toBe(true);
    expect(tight.chars).toBe(size(tight));
    expect(tight.chars).toBeLessThanOrEqual(3_000);
  });

  it("never cuts the task, the criteria or the test cases, even when nothing else is left", () => {
    const out = fitContext(big(), 500);
    expect(out.task).toEqual(big().task);
    expect(out.criteria).toEqual(big().criteria);
    expect(out.testCases).toEqual(big().testCases);
    expect(out.truncated).toBe(true);
  });
});

// The tool, through the real gateway.
const TOKENS = { AM_AGENT_TOKEN: "agent-t", AM_UI_TOKEN: "ui-t", AM_HOOK_TOKEN: "hook-t" };
const FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";
const MAX = 4000;
let db: FalkorDB;
let server: Server;
let base: string;
const graphs = new Set<string>();
const clients: Client[] = [];

beforeAll(async () => {
  db = await connect(FALKORDB_URL);
  const cfg = loadConfig({ ...TOKENS, FALKORDB_URL, CONTEXT_MAX_CHARS: String(MAX) }, "gateway");
  server = createGateway(cfg);
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

async function rejectedWrites(projectId: string): Promise<number> {
  const [row] = await readQuery<{ p: { properties: { rejectedWrites: number } } }>(
    db,
    REGISTRY_GRAPH,
    "read/project",
    { projectId },
  );
  return row!.p.properties.rejectedWrites;
}

async function worker(projectId: string, workerId: string): Promise<Client> {
  const client = new Client({ name: "test", version: "0" });
  const headers = {
    "X-AM-Token": "agent-t",
    "X-AM-Agent": "build",
    "X-AM-Project": projectId,
    "X-AM-Worker": workerId,
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
    content: { text: string }[];
  };
  return result.isError
    ? { error: (JSON.parse(result.content[0]!.text) as { error: Record<string, unknown> }).error }
    : { out: result.structuredContent! };
}

/**
 * A project in build with CARD-01 on REQ-01 (two current facts, one ended), EP-01, one criterion
 * with its TestCase. Each fact comes from its own long episode, so the context must be cut.
 */
async function setup() {
  const now = Date.now();
  const { project, client } = await createProject(db, {
    clientName: `test-client-${randomUUID()}`,
    projectName: "Context",
    mode: "demo",
    createdBy: "human:test",
    now,
  });
  const ctx = { db, graph: `client_${client.id}`, projectId: project.id };
  graphs.add(ctx.graph);
  await setStage(db, project.id, "intake", "build");
  const { episodeIds } = await writeDocument(ctx, {
    name: "kickoff-notes.pdf",
    mime: "application/pdf",
    sha256: "e".repeat(64),
    status: "processed",
    wordCount: 900,
    error: null,
    episodes: [1, 2, 3].map((i) => ({
      page: 1,
      lineStart: i,
      lineEnd: i,
      text: `Episode ${i}. ${"The clinic opens at nine. ".repeat(60)}`.slice(0, 1500),
    })),
    createdBy: "human:test",
    now,
  });
  // A later document: its episode is newer, so it is the last to be dropped.
  const later = await writeDocument(ctx, {
    name: "later-notes.pdf",
    mime: "application/pdf",
    sha256: "f".repeat(64),
    status: "processed",
    wordCount: 300,
    error: null,
    episodes: [
      {
        page: 1,
        lineStart: 1,
        lineEnd: 1,
        text: `Later. ${"Slots are 20 minutes. ".repeat(60)}`.slice(0, 1500),
      },
    ],
    createdBy: "human:test",
    now: now + 1,
  });
  const { factIds } = await writeFacts(ctx, {
    entities: [{ key: "clinic", name: "Clinic", aliases: [] }],
    facts: [0, 1, 2].map((i) => ({
      statement: `Clinic rule ${i} is A.`,
      subject: "clinic",
      attribute: `rule_${i}`,
      value: "A",
      episodeIds: [i === 1 ? later.episodeIds[0]! : episodeIds[i]!],
      replacesFactId: null,
    })),
    createdBy: "intake",
    now,
  });
  // The third fact is ended: replaced by a fourth from the same episode.
  const { factIds: newer } = await writeFacts(ctx, {
    entities: [],
    facts: [
      {
        statement: "Clinic rule 2 is B.",
        subject: "clinic",
        attribute: "rule_2",
        value: "B",
        episodeIds: [episodeIds[2]!],
        replacesFactId: factIds[2]!,
      },
    ],
    createdBy: "intake",
    now: now + 1,
  });
  await writeProduct(ctx, {
    baseVersion: 0,
    requirements: [
      {
        key: "REQ-01",
        text: "A patient can book.",
        priority: "must",
        factIds: [factIds[0]!, factIds[1]!, factIds[2]!],
      },
    ],
    features: [
      {
        key: "FEAT-01",
        name: "Booking",
        featureKind: "form",
        requirementKeys: ["REQ-01"],
        estimate: { rawHours: 4, hours: 4, basis: "raw 4 h, no lesson = 4 h", lessonIds: [] },
      },
    ],
    createdBy: "proposal",
    now,
  });
  await writeDesign(ctx, {
    baseVersion: 0,
    nodes: [
      {
        label: "Endpoint",
        key: "EP-01",
        name: "Book",
        body: "Books a slot.",
        method: "POST",
        path: "/api/bookings",
        requirementKeys: ["REQ-01"],
      },
    ],
    sections: [],
    createdBy: "architect",
    now,
  });
  const { taskIds } = (await writeCards(ctx, {
    cards: [
      {
        key: "CARD-01",
        title: "Book a slot",
        description: "The booking form.",
        lane: "Backend",
        order: 10,
        requirementKey: "REQ-01",
        designKeys: ["EP-01"],
        dependsOn: [],
        criteria: [
          {
            key: "AC-01-1",
            text: "Given a slot, when booked, then it shows.",
            testIds: ["book-submit"],
          },
        ],
      },
    ] as never,
    createdBy: "planner",
    now,
  }))!;
  await writeTests(ctx, {
    taskId: taskIds[0]!,
    cases: [
      { criterionKey: "AC-01-1", file: "tests/e2e/CARD-01/AC-01-1.spec.ts", title: "AC-01-1: t" },
    ],
    createdBy: "test",
    now,
  });
  return { projectId: project.id, taskId: taskIds[0]!, factIds, newerFact: newer[0]! };
}

describe("get_task_context", () => {
  it("Done when: the result stays within CONTEXT_MAX_CHARS, with the card, criteria and tests whole", async () => {
    const { projectId, taskId, factIds } = await setup();
    const w = await worker(projectId, "build-1");
    expect((await call(w, "claim_task", { taskId })).out).toBeDefined();

    const { out } = await call(w, "get_task_context", { taskId });
    const context = out as Out;
    expect(JSON.stringify(context).length).toBeLessThanOrEqual(MAX);
    expect(context.chars).toBe(JSON.stringify(context).length);
    expect(context.truncated).toBe(true);

    expect(context.task).toMatchObject({
      id: taskId,
      key: "CARD-01",
      branch: "card/CARD-01",
      note: null,
    });
    expect(context.requirement.key).toBe("REQ-01");
    // Only the current facts: the ended one is left out.
    expect(context.requirement.facts.map((f) => f.id).sort()).toEqual(
      [factIds[0], factIds[1]].sort(),
    );
    expect(context.criteria).toEqual([
      {
        key: "AC-01-1",
        text: "Given a slot, when booked, then it shows.",
        testIds: ["book-submit"],
      },
    ]);
    expect(context.testCases).toEqual([
      { file: "tests/e2e/CARD-01/AC-01-1.spec.ts", title: "AC-01-1: t", criterionKey: "AC-01-1" },
    ]);
    expect(context.design).toMatchObject([
      { label: "Endpoint", key: "EP-01", name: "Book", method: "POST", path: "/api/bookings" },
    ]);
    // Cut from the oldest: what is left ends with the later document's episode.
    expect(context.episodes.length).toBeGreaterThan(0);
    expect(context.episodes.at(-1)!.documentName).toBe("later-notes.pdf");
    for (const e of context.episodes) {
      expect(e.excerpt.length).toBeLessThanOrEqual(300);
      expect(e.page).toBe(1);
    }
    expect(context.codeChanges).toEqual([]);
    expect(context.defect).toBeNull();
    expect(context.conventions.testIdRule).toContain("data-testid");
  });

  it("answers only the worker that holds the card's lease", async () => {
    const { projectId, taskId } = await setup();
    const holder = await worker(projectId, "build-1");
    const other = await worker(projectId, "build-2");

    expect((await call(holder, "get_task_context", { taskId })).error).toMatchObject({
      guard: "lease",
      details: { reasonCode: "LEASE_ENDED" },
    });
    await call(holder, "claim_task", { taskId });
    const before = await rejectedWrites(projectId);
    expect((await call(other, "get_task_context", { taskId })).error).toMatchObject({
      guard: "lease",
      details: { reasonCode: "LEASE_OTHER_WORKER" },
    });
    expect(await rejectedWrites(projectId)).toBe(before + 1);
    expect((await call(holder, "get_task_context", { taskId })).out).toBeDefined();
  });
});
