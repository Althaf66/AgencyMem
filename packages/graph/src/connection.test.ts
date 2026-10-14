// FalkorDB going down after a client connected, and coming back. A TCP proxy in front of the real
// FalkorDB from docker-compose.yml stands in for the outage. No mocks.
import { createConnection, createServer, type Server, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, expect, it } from "vitest";
import { close, isReachable } from "./index";

const TARGET = new URL(process.env.FALKORDB_URL ?? "redis://localhost:6380");
const sockets = new Set<Socket>();
let proxy: Server | undefined;

function startProxy(port = 0): Promise<number> {
  proxy = createServer((client) => {
    const upstream = createConnection(Number(TARGET.port), TARGET.hostname);
    for (const s of [client, upstream]) {
      sockets.add(s);
      s.on("error", () => s.destroy());
      s.on("close", () => sockets.delete(s));
    }
    client.pipe(upstream).pipe(client);
  });
  return new Promise((resolve) =>
    proxy!.listen(port, "127.0.0.1", () => resolve((proxy!.address() as AddressInfo).port)),
  );
}

async function stopProxy(): Promise<void> {
  for (const s of sockets) s.destroy();
  await new Promise((resolve) => proxy?.close(resolve));
}

async function eventually(check: () => Promise<boolean>, ms: number): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end;) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

afterAll(async () => {
  await stopProxy();
  await close();
});

it("reports down when FalkorDB drops after connecting, without crashing, and recovers", async () => {
  const port = await startProxy();
  const url = `redis://127.0.0.1:${port}`;
  expect(await isReachable(url)).toBe(true);

  await stopProxy();
  expect(await isReachable(url)).toBe(false);

  await startProxy(port);
  expect(await eventually(() => isReachable(url), 10_000)).toBe(true);
}, 20_000);
