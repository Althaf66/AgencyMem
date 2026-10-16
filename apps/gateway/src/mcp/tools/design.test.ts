// write_design (task 3.4) through the real gateway (MCP SDK client) against the real FalkorDB from
// docker-compose.yml. No mocks.
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type Envelope } from "@agencymem/contracts";
import { REGISTRY_GRAPH, close, connect, readQuery, type FalkorDB } from "@agencymem/graph";
import {
  createChangeRequest,
  createGates,
  createProject,
  deleteTestClient,
  flagImpact,
  openItem,
  supersedeFacts,
  writeDesign,
  writeDocument,
  writeFacts,
  writeProduct,
  writeVersioned,
  type Ctx,
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
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});
afterAll(async () => {
  await Promise.allSettled(clients.map((c) => c.close()));
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  for (const graph of graphs) await deleteTestClient(db, graph);
  await close();
});

/** A project with G2 approved (unless `g2` is false), facts F1-F3, REQ-01..03, FEAT-01, an architect item. */
async function setup({ g2 = true } = {}) {
  const now = Date.now();
  const { project, client } = await createProject(db, {
    clientName: `test-client-${randomUUID()}`,
    projectName: "Design",
    mode: "demo",
    createdBy: "human:test",
    now,
  });
  const ctx: Ctx = { db, graph: `client_${client.id}`, projectId: project.id };
  graphs.add(ctx.graph);
  const gates = await createGates(ctx, {
    keys: ["G1", "G2", "G3", "G5"],
    createdBy: "human:test",
    now,
  });
  const gate2 = gates.find((g) => g.key === "G2")!;
  if (g2) {
    await writeVersioned(ctx, {
      id: gate2.id,
      version: gate2.version,
      props: { status: "approved", decidedBy: "human:test", decidedAt: now },
    });
  }
  const { episodeIds } = await writeDocument(ctx, {
    name: "kickoff-notes.pdf",
    mime: "application/pdf",
    sha256: "e".repeat(64),
    status: "processed",
    wordCount: 20,
    error: null,
    episodes: [{ page: 1, lineStart: 1, lineEnd: 3, text: "Three rules." }],
    createdBy: "human:test",
    now,
  });
  const { factIds } = await writeFacts(ctx, {
    entities: [{ key: "clinic", name: "Clinic", aliases: [] }],
    facts: [1, 2, 3].map((i) => ({
      statement: `Clinic rule ${i} is A.`,
      subject: "clinic",
      attribute: `rule_${i}`,
      value: "A",
      episodeIds,
      replacesFactId: null,
    })),
    createdBy: "intake",
    now,
  });
  await writeProduct(ctx, {
    baseVersion: 0,
    requirements: factIds.map((factId, i) => ({
      key: `REQ-0${i + 1}`,
      text: `A patient can use rule ${i + 1}.`,
      priority: "must" as const,
      factIds: [factId],
    })),
    features: [
      {
        key: "FEAT-01",
        name: "Booking",
        featureKind: "form",
        requirementKeys: ["REQ-01", "REQ-02", "REQ-03"],
        estimate: { rawHours: 4, hours: 4, basis: "raw 4 h, no lesson = 4 h", lessonIds: [] },
      },
    ],
    createdBy: "proposal",
    now,
  });
  const item = (await openItem(ctx, { kind: "architect", createdBy: "human:test", now }))!;
  return { ctx, item, facts: factIds };
}

async function agent(projectId: string, agentId = "architect"): Promise<Client> {
  const client = new Client({ name: "test", version: "0" });
  const headers = {
    "X-AM-Token": "agent-t",
    "X-AM-Agent": agentId,
    "X-AM-Project": projectId,
    "X-AM-Worker": `${agentId}-1`,
  };
  await client.connect(
    new StreamableHTTPClientTransport(new URL(base), { requestInit: { headers } }),
  );
  clients.push(client);
  return client;
}

type Result = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content?: { text?: string }[];
};
async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as Result;
  return {
    isError: result.isError === true,
    out:
      result.structuredContent ??
      (JSON.parse(result.content?.[0]?.text ?? "{}") as Record<string, unknown>),
  };
}
const reasonCode = (out: Record<string, unknown>) =>
  (out.error as { details?: { reasonCode?: string } }).details?.reasonCode;
const rows = (ctx: Ctx, cypher: string) =>
  db
    .selectGraph(ctx.graph)
    .roQuery(cypher)
    .then((r) => (r.data ?? []) as Record<string, unknown>[]);

const nodes = [
  {
    label: "Decision",
    key: "DEC-01",
    name: "One process",
    body: "Express serves the API and the pages.",
    requirementKeys: ["REQ-01"],
  },
  {
    label: "Endpoint",
    key: "EP-01",
    name: "Book",
    body: "Books a slot.",
    method: "POST",
    path: "/api/bookings",
    requirementKeys: ["REQ-01", "REQ-02"],
  },
  {
    label: "Screen",
    key: "SCR-01",
    name: "Book page",
    body: "Uses book-name.",
    requirementKeys: ["REQ-03"],
  },
];
const sections = [
  { doc: "prd", order: 0, title: "Summary", body: "One feature.", renders: ["FEAT-01"] },
  {
    doc: "prd",
    order: 2,
    title: "Requirements",
    body: "Three rules.",
    renders: ["REQ-01", "REQ-02", "REQ-03"],
  },
  { doc: "tdd", order: 3, title: "API endpoints", body: "One endpoint.", renders: ["EP-01"] },
  { doc: "plan", order: 2, title: "Test approach", body: "One screen.", renders: ["SCR-01"] },
];
const design = (itemId: string, over: Record<string, unknown> = {}) => ({
  itemId,
  baseVersion: 0,
  nodes,
  sections,
  ...over,
});

describe("write_design: guards", () => {
  it("rejects a write while G2 is not approved, and counts it", async () => {
    const { ctx, item } = await setup({ g2: false });
    const res = await call(await agent(ctx.projectId), "write_design", design(item.id));
    expect(res.out.error).toMatchObject({ guard: "gate" });
    expect(reasonCode(res.out)).toBe("GATE_NOT_APPROVED");
    const [project] = await readQuery<{ p: { properties: { rejectedWrites: number } } }>(
      db,
      REGISTRY_GRAPH,
      "read/project",
      { projectId: ctx.projectId },
    );
    expect(project!.p.properties.rejectedWrites).toBe(1);
  });

  it("rejects an agent that does not own design nodes", async () => {
    const { ctx, item } = await setup();
    const res = await call(await agent(ctx.projectId, "planner"), "write_design", design(item.id));
    expect(res.out.error).toMatchObject({ guard: "ownership" });
  });

  it("rejects a node with an unknown requirement, and a section that renders nothing known (source)", async () => {
    const { ctx, item } = await setup();
    const architect = await agent(ctx.projectId);
    const badNode = await call(
      architect,
      "write_design",
      design(item.id, { nodes: [{ ...nodes[0], requirementKeys: ["REQ-09"] }], sections: [] }),
    );
    expect(badNode.out.error).toMatchObject({ guard: "source" });
    const badSection = await call(
      architect,
      "write_design",
      design(item.id, { sections: [{ ...sections[0], renders: ["CMP-09"] }] }),
    );
    expect(badSection.out.error).toMatchObject({ guard: "source" });
  });

  it("rejects an old baseVersion, and the write query refuses it too (a race)", async () => {
    const { ctx, item } = await setup();
    const architect = await agent(ctx.projectId);
    expect((await call(architect, "write_design", design(item.id))).isError).toBe(false);
    const stale = await call(architect, "write_design", design(item.id));
    expect(reasonCode(stale.out)).toBe("VERSION_OLD");
    const raced = await writeDesign(ctx, {
      baseVersion: 0,
      nodes: [],
      sections: [{ ...sections[0]!, doc: "prd", body: "Raced." }] as never,
      createdBy: "architect",
      now: Date.now(),
    });
    expect(raced).toBeNull();
    expect(
      await rows(
        ctx,
        q("MATCH", "(s:DocSection {doc: 'prd', order: 0})", "RETURN", "s.body AS body"),
      ),
    ).toEqual([{ body: "One feature." }]);
  });
});

describe("write_design: versions and stale sections", () => {
  it("writes version 1 with its edges, then revises a node and a section in place", async () => {
    const { ctx, item } = await setup();
    const architect = await agent(ctx.projectId);
    const sent: Envelope[] = [];
    const off = events.on((e) => e.projectId === ctx.projectId && sent.push(e));
    const v1 = await call(architect, "write_design", design(item.id));
    off();
    expect(v1.isError).toBe(false);
    expect(v1.out).toMatchObject({ designVersion: 1 });
    expect((v1.out.nodeIds as string[]).length).toBe(3);
    expect((v1.out.sectionIds as string[]).length).toBe(4);
    expect(
      sent.filter((e) => e.type === "node.written").map((e) => (e.data as { label: string }).label),
    ).toEqual(["Decision", "Endpoint", "Screen", "DocSection"]);
    expect(
      await rows(
        ctx,
        q(
          "MATCH",
          "(n)-[:DERIVED_FROM]->(r:Requirement)",
          "WHERE",
          "n:Decision OR n:Endpoint OR n:Screen",
          "RETURN",
          "labels(n)[0] AS label, n.key AS key, n.designVersion AS v, collect(r.key) AS reqs",
          "ORDER BY key",
        ),
      ),
    ).toEqual([
      { label: "Decision", key: "DEC-01", v: 1, reqs: ["REQ-01"] },
      { label: "Endpoint", key: "EP-01", v: 1, reqs: expect.arrayContaining(["REQ-01", "REQ-02"]) },
      { label: "Screen", key: "SCR-01", v: 1, reqs: ["REQ-03"] },
    ]);
    expect(
      await rows(
        ctx,
        q(
          "MATCH",
          "(s:DocSection)-[:RENDERS]->(n)",
          "RETURN",
          "s.doc AS doc, s.order AS ord, s.stale AS stale, count(n) AS renders ORDER BY doc, ord",
        ),
      ),
    ).toEqual([
      { doc: "plan", ord: 2, stale: false, renders: 1 },
      { doc: "prd", ord: 0, stale: false, renders: 1 },
      { doc: "prd", ord: 2, stale: false, renders: 3 },
      { doc: "tdd", ord: 3, stale: false, renders: 1 },
    ]);

    // Version 2 changes the endpoint and one section only; the rest stays.
    const v2 = await call(
      architect,
      "write_design",
      design(item.id, {
        baseVersion: 1,
        nodes: [{ ...nodes[1], body: "Books one free slot.", requirementKeys: ["REQ-02"] }],
        sections: [
          { ...sections[2], body: "One endpoint, revised.", renders: ["EP-01", "REQ-02"] },
        ],
      }),
    );
    expect(v2.out).toMatchObject({ designVersion: 2, nodeIds: [(v1.out.nodeIds as string[])[1]] });
    expect(
      await rows(
        ctx,
        q(
          "MATCH",
          "(n:Endpoint)-[:DERIVED_FROM]->(r:Requirement)",
          "RETURN",
          "n.body AS body, n.version AS version, n.designVersion AS v, collect(r.key) AS reqs",
        ),
      ),
    ).toEqual([{ body: "Books one free slot.", version: 2, v: 2, reqs: ["REQ-02"] }]);
    expect(
      await rows(
        ctx,
        q(
          "MATCH",
          "(s:DocSection)-[:RENDERS]->(n)",
          "WHERE",
          "s.doc = 'tdd'",
          "RETURN",
          "s.body AS body, s.designVersion AS v, count(n) AS renders",
        ),
      ),
    ).toEqual([{ body: "One endpoint, revised.", v: 2, renders: 2 }]);
  });

  it("clears stale on a section the Architect writes again", async () => {
    const { ctx, item, facts } = await setup();
    const architect = await agent(ctx.projectId);
    await call(architect, "write_design", design(item.id));
    const now = Date.now();
    const { changeRequest } = await createChangeRequest(ctx, {
      text: "Rule 3 is B.",
      createdBy: "human:ana",
      now,
    });
    await supersedeFacts(ctx, {
      crId: changeRequest.id,
      status: "applied",
      changes: [{ oldFactId: facts[2]!, statement: "Clinic rule 3 is B.", value: "B" }],
      createdBy: "proposal",
      now,
    });
    await flagImpact(ctx, { crId: changeRequest.id, factIds: [facts[2]!] });
    const stale = () =>
      rows(
        ctx,
        q(
          "MATCH",
          "(s:DocSection)",
          "WHERE",
          "s.stale = true",
          "RETURN",
          "s.doc AS doc, s.order AS ord ORDER BY doc, ord",
        ),
      );
    expect(await stale()).toEqual([
      { doc: "plan", ord: 2 },
      { doc: "prd", ord: 2 },
    ]);
    const res = await call(
      architect,
      "write_design",
      design(item.id, { baseVersion: 1, nodes: [], sections: [sections[1], sections[3]] }),
    );
    expect(res.isError).toBe(false);
    expect(await stale()).toEqual([]);
  });
});

describe("write_design: a nodes-only write, a key that changes, a relabelled key", () => {
  it("moves the design version on a nodes-only write, then accepts a sections-only one", async () => {
    const { ctx, item } = await setup();
    const architect = await agent(ctx.projectId);
    await call(architect, "write_design", design(item.id));
    const nodesOnly = await call(
      architect,
      "write_design",
      design(item.id, { baseVersion: 1, nodes: [{ ...nodes[0], body: "Changed." }], sections: [] }),
    );
    expect(nodesOnly.out).toMatchObject({ designVersion: 2, sectionIds: [] });
    const sectionsOnly = await call(
      architect,
      "write_design",
      design(item.id, { baseVersion: 2, nodes: [], sections: [sections[0]] }),
    );
    expect(sectionsOnly.out).toMatchObject({ designVersion: 3, nodeIds: [] });
  });

  it("writes nothing when a requirement it names ended after the gateway read it (a race)", async () => {
    const { ctx } = await setup();
    // REQ-03 ends after the gateway's guard would have read it.
    const [r3] = await rows(
      ctx,
      q("MATCH", "(r:Requirement {key: 'REQ-03'})", "RETURN", "r.id AS id, r.version AS version"),
    );
    await writeVersioned(ctx, {
      id: r3!.id as string,
      version: r3!.version as number,
      props: { validTo: Date.now() },
    });
    const raced = await writeDesign(ctx, {
      baseVersion: 0,
      nodes: nodes as never,
      sections: sections as never,
      createdBy: "architect",
      now: Date.now(),
    });
    expect(raced).toBeNull();
    expect(
      await rows(
        ctx,
        q(
          "MATCH",
          "(n)",
          "WHERE",
          "n:Decision OR n:Endpoint OR n:Screen OR n:DocSection",
          "RETURN",
          "count(n) AS n",
        ),
      ),
    ).toEqual([{ n: 0 }]);
  });

  it("refuses a key that already exists under another label", async () => {
    const { ctx, item } = await setup();
    const architect = await agent(ctx.projectId);
    await call(architect, "write_design", design(item.id));
    const res = await call(
      architect,
      "write_design",
      design(item.id, {
        baseVersion: 1,
        nodes: [{ ...nodes[0], label: "Component", key: "DEC-01" }],
        sections: [],
      }),
    );
    expect(res.out.error).toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("route 21: POST /api/chat, tenancy first", () => {
  const chat = (headers: Record<string, string>, body: Record<string, unknown>) =>
    fetch(base.replace(/\/mcp$/, "/api/chat"), {
      method: "POST",
      headers: {
        "X-AM-Token": "ui-t",
        "X-AM-Actor": "human:ana",
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    });

  it("refuses a chat with no project (tenancy) and an unknown section (404)", async () => {
    const missing = await chat({}, { text: "Hello." });
    expect(missing.status).toBe(403);
    expect(((await missing.json()) as { error: unknown }).error).toMatchObject({
      guard: "tenancy",
      details: { reasonCode: "PROJECT_MISSING" },
    });
    const { ctx } = await setup();
    const unknown = await chat(
      { "X-AM-Project": ctx.projectId },
      { text: "Hello.", docSectionId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" },
    );
    expect(unknown.status).toBe(404);
  });
});
