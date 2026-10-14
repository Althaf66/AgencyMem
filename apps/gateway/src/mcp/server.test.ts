// The MCP endpoint, driven by the SDK client an MCP inspector uses, against the real gateway and the
// real FalkorDB from docker-compose.yml. No mocks.
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ToolName, loadConfig } from "@agencymem/contracts";
import { close, connect } from "@agencymem/graph";
import { createProject } from "@agencymem/memory";
import { createEvents } from "../events/bus";
import { createGateway } from "../main";
import { createMcpServer } from "./server";

const TOKENS = { AM_AGENT_TOKEN: "agent-t", AM_UI_TOKEN: "ui-t", AM_HOOK_TOKEN: "hook-t" };
const FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";
const UNKNOWN_PROJECT = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

let server: Server;
let base: string;
let projectId: string;
let clientGraph: string;
const clients: Client[] = [];

beforeAll(async () => {
  const db = await connect(FALKORDB_URL);
  const { project, client } = await createProject(db, {
    clientName: `test-client-${randomUUID()}`,
    projectName: "MCP test",
    mode: "demo",
    createdBy: "human:test",
    now: Date.now(),
  });
  projectId = project.id;
  clientGraph = `client_${client.id}`;

  server = createGateway(loadConfig({ ...TOKENS, FALKORDB_URL }, "gateway"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});
afterAll(async () => {
  await Promise.allSettled(clients.map((c) => c.close()));
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await (await connect(FALKORDB_URL)).selectGraph(clientGraph).delete();
  await close();
});

const agentHeaders = () => ({
  "X-AM-Token": "agent-t",
  "X-AM-Agent": "intake",
  "X-AM-Project": projectId,
  "X-AM-Worker": "intake-1",
});

async function mcpClient(headers: Record<string, string>): Promise<Client> {
  const client = new Client({ name: "test-inspector", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(base), { requestInit: { headers } }),
  );
  clients.push(client);
  return client;
}

/** A raw initialize request, to see the HTTP status the gateway gives a refused session. */
function initialize(headers: Record<string, string>) {
  return fetch(base, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "raw", version: "0" },
      },
    }),
  });
}

describe("tools/list (Done when: an MCP inspector lists the tools)", () => {
  it("lists all 21 tools with input and output schemas to an agent session", async () => {
    const client = await mcpClient(agentHeaders());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...ToolName.options].sort());
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.outputSchema?.type).toBe("object");
      expect(tool.description).toBeTruthy();
    }
  });

  it("lists the same 21 tools to a UI session, which needs only X-AM-Project", async () => {
    const client = await mcpClient({ "X-AM-Token": "ui-t", "X-AM-Project": projectId });
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(21);
  });
});

describe("session headers (Done when: a missing X-AM-* header is refused)", () => {
  it.each(["X-AM-Agent", "X-AM-Project", "X-AM-Worker"])(
    "refuses an agent session without %s: HTTP 400, no session",
    async (header) => {
      const headers: Record<string, string> = agentHeaders();
      delete headers[header];
      const res = await initialize(headers);
      expect(res.status).toBe(400);
      expect(res.headers.get("mcp-session-id")).toBeNull();
      expect(await res.json()).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
    },
  );

  it.each([
    ["an unknown agent", { "X-AM-Agent": "janitor" }],
    ["a bad worker id", { "X-AM-Worker": "Build_1" }],
    ["an unknown project", { "X-AM-Project": UNKNOWN_PROJECT }],
    ["a project id that is not a ULID", { "X-AM-Project": "nope" }],
  ])("refuses %s", async (_name, override) => {
    const res = await initialize({ ...agentHeaders(), ...override });
    expect(res.status).toBe(400);
    expect(res.headers.get("mcp-session-id")).toBeNull();
  });

  it("refuses a UI session without X-AM-Project", async () => {
    const res = await initialize({ "X-AM-Token": "ui-t" });
    expect(res.status).toBe(400);
  });

  it("opens a session with all headers", async () => {
    const res = await initialize(agentHeaders());
    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBeTruthy();
  });
});

describe("session map", () => {
  it("answers 404 to an unknown Mcp-Session-Id", async () => {
    const res = await fetch(base, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "X-AM-Token": "agent-t",
        "Mcp-Session-Id": randomUUID(),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    expect(res.status).toBe(404);
  });

  it("refuses a session id used with the other kind of token", async () => {
    const res = await initialize(agentHeaders());
    const sessionId = res.headers.get("mcp-session-id")!;
    const hijack = await fetch(base, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "X-AM-Token": "ui-t",
        "Mcp-Session-Id": sessionId,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
    });
    expect(hijack.status).toBe(401);
  });
});

describe("bad request bodies get the contract's error body, never an HTML stack trace", () => {
  it.each([
    ["malformed JSON", "{not json"],
    ["a body over 1 MB", JSON.stringify({ pad: "x".repeat(1_100_000) })],
  ])("answers %s with 400 VALIDATION_FAILED as JSON", async (_name, body) => {
    const res = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...agentHeaders() },
      body,
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const text = await res.text();
    expect(text).not.toMatch(/at .*\.(js|ts):\d+/); // no stack trace
    expect(JSON.parse(text)).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });
});

describe("a call that throws still answers in the contract shape", () => {
  // One session's server, linked to a client in memory, with FalkorDB unreachable.
  async function downClient(up: boolean): Promise<Client> {
    const binding = {
      kind: "agent",
      agent: "intake",
      workerId: "intake-1",
      projectId: UNKNOWN_PROJECT,
      graph: "client_x",
    } as const;
    const server = createMcpServer(binding, {
      db: () => Promise.reject(new Error("connect ECONNREFUSED")),
      isUp: async () => up,
      events: createEvents(),
      leaseMs: 1000,
      recallMaxChars: 40000,
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(clientSide);
    clients.push(client);
    return client;
  }

  it("answers GRAPH_UNAVAILABLE when FalkorDB is down", async () => {
    const client = await downClient(false);
    const result = await client.callTool({ name: "claim_item", arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code: "GRAPH_UNAVAILABLE" } });
  });

  it("answers INTERNAL for any other error", async () => {
    const client = await downClient(true);
    const result = await client.callTool({ name: "claim_item", arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code: "INTERNAL" } });
  });
});

describe("tools/call errors use the contract shape", () => {
  it("returns VALIDATION_FAILED as structuredContent for bad input", async () => {
    const client = await mcpClient(agentHeaders());
    const result = await client.callTool({
      name: "heartbeat",
      arguments: { itemId: "not-a-ulid" },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });
});
