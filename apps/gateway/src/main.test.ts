// Starts the gateway on a free port against the real FalkorDB from docker-compose.yml. No mocks.
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { loadConfig } from "@agencymem/contracts";
import { close } from "@agencymem/graph";
import { createGateway } from "./main";

const TOKENS = { AM_AGENT_TOKEN: "agent-t", AM_UI_TOKEN: "ui-t", AM_HOOK_TOKEN: "hook-t" };
const FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";
const servers: Server[] = [];

async function start(falkordbUrl: string): Promise<string> {
  const server = createGateway(loadConfig({ ...TOKENS, FALKORDB_URL: falkordbUrl }, "gateway"));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `127.0.0.1:${(server.address() as AddressInfo).port}`;
}

let host: string;
beforeAll(async () => {
  host = await start(FALKORDB_URL);
});
afterAll(async () => {
  for (const s of servers) {
    s.closeAllConnections();
    await new Promise((resolve) => s.close(resolve));
  }
  await close();
});

const get = (path: string, token?: string) =>
  fetch(`http://${host}${path}`, { headers: token ? { "X-AM-Token": token } : {} });

describe("/healthz", () => {
  it("reports FalkorDB as reachable", async () => {
    const res = await get("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, falkordb: "up", version: "0.1.0" });
  });

  it("answers 503 when FalkorDB is down", async () => {
    const downHost = await start("redis://127.0.0.1:6399");
    const res = await fetch(`http://${downHost}/healthz`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, falkordb: "down", version: "0.1.0" });
  });
});

describe("one token check per route group", () => {
  it.each([
    ["/api/projects", "ui-t", ["agent-t", "hook-t"]],
    ["/api/runs/steps", "agent-t", ["ui-t", "hook-t"]],
    ["/hooks/commit", "hook-t", ["ui-t", "agent-t"]],
    ["/mcp", "agent-t", ["hook-t"]],
    ["/mcp", "ui-t", ["hook-t"]],
  ])("%s takes %s and refuses the others", async (path, own, others) => {
    for (const token of [undefined, "wrong", ...others]) {
      const res = await get(path, token);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
    }
    // Past the token check: whatever the route says next, it is not 401.
    expect((await get(path, own)).status).not.toBe(401);
  });

  it("answers an unknown path with the contract's NOT_FOUND body", async () => {
    const res = await get("/nowhere");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("/ws opens with the UI token and refuses any other", async () => {
    const open = (token: string) =>
      new Promise<number>((resolve) => {
        const ws = new WebSocket(`ws://${host}/ws?token=${token}`);
        ws.on("open", () => {
          ws.close();
          resolve(101);
        });
        ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
        ws.on("error", () => undefined);
      });
    expect(await open("ui-t")).toBe(101);
    expect(await open("agent-t")).toBe(401);
    expect(await open("")).toBe(401);
  });
});
