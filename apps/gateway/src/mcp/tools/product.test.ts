// write_product (task 3.1) through the real gateway (MCP SDK client) against the real FalkorDB from
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
  createGates,
  createProject,
  deleteTestClient,
  openItem,
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

/**
 * A project with its gates (G1 approved unless `g1` is false), one episode, three current facts
 * F1-F3 and a superseded one, and an open proposal item.
 */
async function setup({ g1 = true } = {}) {
  const now = Date.now();
  const { project, client } = await createProject(db, {
    clientName: `test-client-${randomUUID()}`,
    projectName: "Product",
    mode: "demo",
    createdBy: "human:test",
    now,
  });
  const ctx: Ctx = { db, graph: `client_${client.id}`, projectId: project.id };
  graphs.add(ctx.graph);
  const gates = await createGates(ctx, {
    keys: ["G1", "G2", "G3"],
    createdBy: "human:test",
    now,
  });
  const gate1 = gates.find((g) => g.key === "G1")!;
  if (g1) {
    await writeVersioned(ctx, {
      id: gate1.id,
      version: gate1.version,
      props: { status: "approved", decidedBy: "human:test", decidedAt: now },
    });
  }
  const { episodeIds } = await writeDocument(ctx, {
    name: "kickoff-notes.pdf",
    mime: "application/pdf",
    sha256: "c".repeat(64),
    status: "processed",
    wordCount: 20,
    error: null,
    episodes: [{ page: 1, lineStart: 1, lineEnd: 2, text: "Slots are 20 minutes. Open 9 to 5." }],
    createdBy: "human:test",
    now,
  });
  const entity = { key: "clinic", name: "Clinic", aliases: [] };
  const fact = (attribute: string, value: string) => ({
    statement: `The clinic ${attribute} is ${value}.`,
    subject: "clinic",
    attribute,
    value,
    episodeIds,
    replacesFactId: null,
  });
  const first = await writeFacts(ctx, {
    entities: [entity],
    facts: [fact("slot_minutes", "30"), fact("hours", "09:00 to 17:00"), fact("days", "Mon-Sat")],
    createdBy: "intake",
    now,
  });
  const [old, F2, F3] = first.factIds as [string, string, string];
  const second = await writeFacts(ctx, {
    entities: [entity],
    facts: [{ ...fact("slot_minutes", "20"), replacesFactId: old }],
    createdBy: "intake",
    now,
  });
  const F1 = second.factIds[0]!;
  const item = (await openItem(ctx, { kind: "proposal", createdBy: "human:test", now }))!;
  return { ctx, item, facts: { F1, F2, F3, old } };
}

async function agent(projectId: string, agentId = "proposal"): Promise<Client> {
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
async function rejectedWrites(projectId: string): Promise<number> {
  const [project] = await readQuery<{ p: { properties: { rejectedWrites: number } } }>(
    db,
    REGISTRY_GRAPH,
    "read/project",
    { projectId },
  );
  return project!.p.properties.rejectedWrites;
}

const estimate = (rawHours: number) => ({
  rawHours,
  hours: rawHours,
  basis: `raw ${rawHours} h, no lesson = ${rawHours} h`,
  lessonIds: [],
});
type Facts = Awaited<ReturnType<typeof setup>>["facts"];
const product = (itemId: string, facts: Facts, over: Record<string, unknown> = {}) => ({
  itemId,
  baseVersion: 0,
  requirements: [
    {
      key: "REQ-01",
      text: "A patient can book one free 20-minute slot.",
      priority: "must",
      factIds: [facts.F1],
    },
    {
      key: "REQ-02",
      text: "A patient sees the hours 09:00 to 17:00.",
      priority: "should",
      factIds: [facts.F2, facts.F3],
    },
  ],
  features: [
    {
      key: "FEAT-01",
      name: "Slot calendar",
      featureKind: "calendar",
      requirementKeys: ["REQ-01"],
      estimate: estimate(7),
    },
    {
      key: "FEAT-02",
      name: "Home page",
      featureKind: "content_page",
      requirementKeys: ["REQ-02"],
      estimate: estimate(2),
    },
  ],
  ...over,
});

describe("write_product: guards", () => {
  it("rejects a write while G1 is not approved, and counts it", async () => {
    const { ctx, item, facts } = await setup({ g1: false });
    const sent: Envelope[] = [];
    const off = events.on((e) => e.projectId === ctx.projectId && sent.push(e));
    const res = await call(await agent(ctx.projectId), "write_product", product(item.id, facts));
    off();
    expect(res.isError).toBe(true);
    expect(res.out.error).toMatchObject({ code: "GUARD_REJECTED", guard: "gate" });
    expect(reasonCode(res.out)).toBe("GATE_NOT_APPROVED");
    expect(await rejectedWrites(ctx.projectId)).toBe(1);
    expect(sent.map((e) => e.type)).toContain("write.rejected");
    expect(await rows(ctx, q("MATCH", "(r:Requirement)", "RETURN", "count(r) AS n"))).toEqual([
      { n: 0 },
    ]);
  });

  it("rejects an agent that does not own Requirement", async () => {
    const { ctx, item, facts } = await setup();
    const res = await call(
      await agent(ctx.projectId, "discovery"),
      "write_product",
      product(item.id, facts),
    );
    expect(res.out.error).toMatchObject({ guard: "ownership" });
  });

  it("rejects a requirement whose fact is replaced or unknown (source)", async () => {
    const { ctx, item, facts } = await setup();
    const proposal = await agent(ctx.projectId);
    const replaced = product(item.id, facts);
    (replaced.requirements as { factIds: string[] }[])[1]!.factIds = [facts.old];
    const res = await call(proposal, "write_product", replaced);
    expect(res.out.error).toMatchObject({ guard: "source" });
    expect(reasonCode(res.out)).toBe("SOURCE_UNKNOWN");
    expect((res.out.error as { details: { index: number } }).details.index).toBe(1);
  });

  it("refuses a feature that names a requirement not in the input", async () => {
    const { ctx, item, facts } = await setup();
    const input = product(item.id, facts);
    (input.features as { requirementKeys: string[] }[])[0]!.requirementKeys = ["REQ-09"];
    const res = await call(await agent(ctx.projectId), "write_product", input);
    expect(res.out.error).toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("rejects an old baseVersion (version)", async () => {
    const { ctx, item, facts } = await setup();
    const res = await call(
      await agent(ctx.projectId),
      "write_product",
      product(item.id, facts, { baseVersion: 1 }),
    );
    expect(res.out.error).toMatchObject({ guard: "version" });
    expect(reasonCode(res.out)).toBe("VERSION_OLD");
  });
});

describe("write_product: versions", () => {
  it("writes version 1, then a version 2 that ends what it leaves out", async () => {
    const { ctx, item, facts } = await setup();
    const proposal = await agent(ctx.projectId);
    const sent: Envelope[] = [];
    const off = events.on((e) => e.projectId === ctx.projectId && sent.push(e));
    const v1 = await call(proposal, "write_product", product(item.id, facts));
    off();
    expect(v1.out).not.toHaveProperty("error");
    expect(v1.isError).toBe(false);
    expect(v1.out).toMatchObject({ productVersion: 1, ended: [] });
    expect((v1.out.requirementIds as string[]).length).toBe(2);
    expect((v1.out.estimateIds as string[]).length).toBe(2);
    expect(
      sent.filter((e) => e.type === "node.written").map((e) => (e.data as { label: string }).label),
    ).toEqual(["Requirement", "Feature", "Estimate"]);

    // Each Requirement DERIVED_FROM its facts; each Feature HAS_REQUIREMENT; one Estimate FOR it.
    expect(
      await rows(
        ctx,
        q(
          "MATCH",
          "(r:Requirement)-[:DERIVED_FROM]->(f:Fact)",
          "RETURN",
          "r.key AS key, r.productVersion AS v, count(f) AS facts ORDER BY key",
        ),
      ),
    ).toEqual([
      { key: "REQ-01", v: 1, facts: 1 },
      { key: "REQ-02", v: 1, facts: 2 },
    ]);
    expect(
      await rows(
        ctx,
        q(
          "MATCH",
          "(e:Estimate)-[:FOR]->(x:Feature)-[:HAS_REQUIREMENT]->(r:Requirement)",
          "RETURN",
          "x.key AS key, x.featureKind AS kind, e.rawHours AS raw, e.hours AS hours,",
          "e.basis AS basis, e.lessonIds AS lessonIds, e.productVersion AS v, r.key AS req",
          "ORDER BY key",
        ),
      ),
    ).toEqual([
      {
        key: "FEAT-01",
        kind: "calendar",
        raw: 7,
        hours: 7,
        basis: "raw 7 h, no lesson = 7 h",
        lessonIds: [],
        v: 1,
        req: "REQ-01",
      },
      {
        key: "FEAT-02",
        kind: "content_page",
        raw: 2,
        hours: 2,
        basis: "raw 2 h, no lesson = 2 h",
        lessonIds: [],
        v: 1,
        req: "REQ-02",
      },
    ]);

    // Version 2 keeps REQ-01 and FEAT-01 (new text, new estimate) and leaves out the rest.
    const v2 = await call(
      proposal,
      "write_product",
      product(item.id, facts, {
        baseVersion: 1,
        requirements: [
          {
            key: "REQ-01",
            text: "A patient can book one 20-minute slot.",
            priority: "must",
            factIds: [facts.F1, facts.F2],
          },
        ],
        features: [
          {
            key: "FEAT-01",
            name: "Slot calendar",
            featureKind: "calendar",
            requirementKeys: ["REQ-01"],
            estimate: estimate(5),
          },
        ],
      }),
    );
    expect(v2.isError).toBe(false);
    expect(v2.out.productVersion).toBe(2);
    expect(v2.out.requirementIds).toEqual([(v1.out.requirementIds as string[])[0]]);
    expect(v2.out.estimateIds).toEqual([(v1.out.estimateIds as string[])[0]]); // in place
    expect([...(v2.out.ended as string[])].sort()).toEqual(
      [(v1.out.requirementIds as string[])[1]!, (v1.out.featureIds as string[])[1]!].sort(),
    );

    expect(
      await rows(
        ctx,
        q(
          "MATCH",
          "(r:Requirement)",
          "OPTIONAL MATCH",
          "(r)-[:DERIVED_FROM]->(f:Fact)",
          "RETURN",
          "r.key AS key, r.text AS text, r.version AS version, r.productVersion AS v,",
          "r.validTo IS NULL AS current, count(f) AS facts ORDER BY key",
        ),
      ),
    ).toEqual([
      {
        key: "REQ-01",
        text: "A patient can book one 20-minute slot.",
        version: 2,
        v: 2,
        current: true,
        facts: 2,
      },
      {
        key: "REQ-02",
        text: "A patient sees the hours 09:00 to 17:00.",
        version: 2,
        v: 1,
        current: false,
        facts: 2,
      },
    ]);
    expect(
      await rows(
        ctx,
        q(
          "MATCH",
          "(e:Estimate)-[:FOR]->(x:Feature)",
          "RETURN",
          "x.key AS key, x.validTo IS NULL AS current, e.rawHours AS raw, e.version AS version",
          "ORDER BY key",
        ),
      ),
    ).toEqual([
      { key: "FEAT-01", current: true, raw: 5, version: 2 },
      { key: "FEAT-02", current: false, raw: 2, version: 1 },
    ]);

    // The first version is old now.
    const stale = await call(proposal, "write_product", product(item.id, facts));
    expect(reasonCode(stale.out)).toBe("VERSION_OLD");
  });
});

describe("write_product: the version check inside the write query", () => {
  it("changes nothing when baseVersion is old, even past the gateway's guard (a race)", async () => {
    const { ctx, item, facts } = await setup();
    const v1 = await call(await agent(ctx.projectId), "write_product", product(item.id, facts));
    expect(v1.isError).toBe(false);
    const before = await rows(
      ctx,
      q(
        "MATCH",
        "(n)",
        "WHERE",
        "n:Requirement OR n:Feature OR n:Estimate",
        "RETURN",
        "n.id AS id, n.version AS version ORDER BY id",
      ),
    );

    const stale = await writeProduct(ctx, {
      baseVersion: 0,
      requirements: [
        {
          key: "REQ-09",
          text: "A patient can do something else.",
          priority: "must",
          factIds: [facts.F1],
        },
      ],
      features: [
        {
          key: "FEAT-09",
          name: "Other",
          featureKind: "form",
          requirementKeys: ["REQ-09"],
          estimate: estimate(3),
        },
      ],
      createdBy: "proposal",
      now: Date.now(),
    });
    expect(stale).toBeNull();
    expect(
      await rows(
        ctx,
        q(
          "MATCH",
          "(n)",
          "WHERE",
          "n:Requirement OR n:Feature OR n:Estimate",
          "RETURN",
          "n.id AS id, n.version AS version ORDER BY id",
        ),
      ),
    ).toEqual(before);
  });
});
