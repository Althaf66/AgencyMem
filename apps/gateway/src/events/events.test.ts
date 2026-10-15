// Live events over the WebSocket, against the real gateway and the real FalkorDB from
// docker-compose.yml. Writes come from MCP tool calls, as an agent makes them. No mocks.
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { createConnection, type AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ulid } from "ulid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { loadConfig, type ServerMessage } from "@agencymem/contracts";
import { close, connect, type FalkorDB } from "@agencymem/graph";
import { createProject, openItem, type Ctx, deleteTestClient } from "@agencymem/memory";
import { createGateway } from "../main";
import { createEvents } from "./bus";

const TOKENS = { AM_AGENT_TOKEN: "agent-t", AM_UI_TOKEN: "ui-t", AM_HOOK_TOKEN: "hook-t" };
const FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";

let db: FalkorDB;
let server: Server;
let host: string;
let ctx: Ctx;
let agent: Client;
const events = createEvents();
const sockets: WebSocket[] = [];

beforeAll(async () => {
  db = await connect(FALKORDB_URL);
  const { project, client } = await createProject(db, {
    clientName: `test-client-${randomUUID()}`,
    projectName: "Events",
    mode: "demo",
    createdBy: "human:test",
    now: Date.now(),
  });
  ctx = { db, graph: `client_${client.id}`, projectId: project.id };
  server = createGateway(loadConfig({ ...TOKENS, FALKORDB_URL }, "gateway"), { events });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  host = `127.0.0.1:${(server.address() as AddressInfo).port}`;

  agent = new Client({ name: "test", version: "0" });
  await agent.connect(
    new StreamableHTTPClientTransport(new URL(`http://${host}/mcp`), {
      requestInit: {
        headers: {
          "X-AM-Token": "agent-t",
          "X-AM-Agent": "intake",
          "X-AM-Project": ctx.projectId,
          "X-AM-Worker": "intake-1",
        },
      },
    }),
  );
});
afterAll(async () => {
  for (const s of sockets) s.terminate();
  await agent.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await deleteTestClient(db, ctx.graph);
  await close();
});

/** A WebSocket client that keeps every message it gets. */
async function socket() {
  const ws = new WebSocket(`ws://${host}/ws?token=ui-t`);
  sockets.push(ws);
  const messages: ServerMessage[] = [];
  ws.on("message", (raw) => messages.push(JSON.parse(String(raw)) as ServerMessage));
  await new Promise((resolve) => ws.once("open", resolve));
  return {
    messages,
    send: (body: unknown) => ws.send(typeof body === "string" ? body : JSON.stringify(body)),
    close: () => new Promise((resolve) => (ws.once("close", resolve), ws.close())),
    async waitFor(count: number) {
      for (const end = Date.now() + 5000; messages.length < count && Date.now() < end;) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(messages).toHaveLength(count);
      return messages;
    },
  };
}
const seqs = (messages: ServerMessage[]) =>
  messages.map((m) => (m.type === "event" ? m.event.seq : -1));

const tool = (name: string, args: Record<string, unknown>) =>
  agent.callTool({ name, arguments: args });
const open = () =>
  openItem(ctx, { kind: "intake", subjectId: ulid(), createdBy: "human:test", now: Date.now() });

describe("Done when: seq rises by one per write, and a client replays after reconnect", () => {
  it("streams each write's events in seq order, then replays the missed ones on reconnect", async () => {
    const first = (await open())!;
    const second = (await open())!;
    const start = events.current(ctx.projectId); // the seq a snapshot would carry

    const live = await socket();
    live.send({ type: "subscribe", projectId: ctx.projectId, since: start });

    await tool("claim_item", { itemId: first.id }); // 1 event
    await tool("heartbeat", { itemId: first.id }); // 1 event
    await tool("complete_item", { itemId: first.id, outcome: "done", runs: [] }); // 2 events
    const got = await live.waitFor(4);
    expect(seqs(got)).toEqual([start + 1, start + 2, start + 3, start + 4]);
    expect(got.map((m) => (m.type === "event" ? m.event.type : m.type))).toEqual([
      "lease.changed",
      "lease.changed",
      "lease.changed",
      "node.written",
    ]);

    // Disconnect, miss two writes, reconnect with the last seq seen.
    const last = start + 4;
    await live.close();
    await tool("claim_item", { itemId: second.id });
    await tool("heartbeat", { itemId: second.id });

    const again = await socket();
    again.send({ type: "subscribe", projectId: ctx.projectId, since: last });
    expect(seqs(await again.waitFor(2))).toEqual([last + 1, last + 2]); // the replay
    await tool("complete_item", { itemId: second.id, outcome: "done", runs: [] });
    expect(seqs(await again.waitFor(4))).toEqual([last + 1, last + 2, last + 3, last + 4]); // live
  });
});

describe("socket safety", () => {
  it("survives a malformed frame: the gateway keeps answering", async () => {
    const [h, port] = host.split(":");
    const raw = createConnection(Number(port), h);
    raw.on("error", () => undefined);
    raw.write(
      [
        "GET /ws?token=ui-t HTTP/1.1",
        `Host: ${host}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version: 13",
        "",
        "",
      ].join("\r\n"),
    );
    await once(raw, "data"); // 101 Switching Protocols
    raw.write(Buffer.from([0x83, 0x80, 0, 0, 0, 0])); // opcode 3 does not exist
    await once(raw, "close");
    expect((await fetch(`http://${host}/healthz`)).status).toBe(200);
  });

  it("closes the server while a WebSocket client is still connected", async () => {
    const other = createGateway(loadConfig({ ...TOKENS, FALKORDB_URL }, "gateway"));
    await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", resolve));
    const port = (other.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=ui-t`);
    ws.on("error", () => undefined);
    await once(ws, "open");

    const closed = new Promise((resolve) => other.close(resolve));
    const timeout = new Promise((resolve) => setTimeout(() => resolve("timeout"), 3000));
    expect(await Promise.race([closed.then(() => "closed"), timeout])).toBe("closed");
  });
});

describe("subscribe", () => {
  it("tells a client that is too far behind to reload its snapshots", async () => {
    const s = await socket();
    s.send({ type: "subscribe", projectId: ctx.projectId, since: 1 });
    expect(await s.waitFor(1)).toEqual([
      { type: "reset", projectId: ctx.projectId, seq: events.current(ctx.projectId) },
    ]);
  });

  it("sends only live events when the client sends no `since`", async () => {
    const s = await socket();
    s.send({ type: "subscribe", projectId: ctx.projectId });
    const item = (await open())!;
    await new Promise((resolve) => setTimeout(resolve, 50)); // let the subscription land
    await tool("claim_item", { itemId: item.id });
    const [only] = await s.waitFor(1);
    expect(only).toMatchObject({ type: "event", event: { type: "lease.changed" } });
  });

  it("answers an unknown project and a bad message with an error", async () => {
    const s = await socket();
    s.send({ type: "subscribe", projectId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" });
    s.send("hello");
    const errors = await s.waitFor(2);
    expect(errors.map((m) => m.type === "error" && m.error.code).sort()).toEqual([
      "NOT_FOUND",
      "VALIDATION_FAILED",
    ]);
  });
});
