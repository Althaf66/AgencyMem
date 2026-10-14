// Runs against the real FalkorDB from docker-compose.yml. No mocks.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { close, connect, graphFor, readQuery, type FalkorDB } from "@agencymem/graph";
import { createProject } from "./index";

const URL_ = process.env.FALKORDB_URL ?? "redis://localhost:6380";
const created: string[] = [];
let db: FalkorDB;

beforeAll(async () => {
  db = await connect(URL_);
});
afterAll(async () => {
  for (const graph of new Set(created)) await db.selectGraph(graph).delete();
  await close();
});

it("writes Client and Project to the registry, reuses a client by name, and readies its graph", async () => {
  const clientName = `test-client-${randomUUID()}`;
  const input = { clientName, mode: "demo" as const, createdBy: "human:test" as const, now: 5 };

  const first = await createProject(db, { ...input, projectName: "Booking" });
  const second = await createProject(db, { ...input, projectName: "Portal" });

  expect(first.project).toMatchObject({
    clientId: first.client.id,
    name: "Booking",
    mode: "demo",
    stage: "intake",
    closedAt: null,
    rejectedWrites: 0,
    rejectedClaims: 0,
    rejectedCompletions: 0,
    rejectedQueries: 0,
    createdBy: "human:test",
    createdAt: 5,
    version: 1,
  });
  expect(second.client.id).toBe(first.client.id); // same client name: same client and graph
  expect(second.project.id).not.toBe(first.project.id);

  // The router now finds the project (the positive routing case deferred from task 1.2) ...
  const graph = await graphFor(db, first.project.id);
  expect(graph).toBe(`client_${first.client.id}`);
  created.push(graph);
  // ... and the client graph exists with its schema.
  const indexes = await readQuery<{ label: string }>(db, graph, "read/indexes", {});
  expect(indexes.map((i) => i.label)).toContain("WorkItem");
});

it("refuses a name over 80 characters before writing anything", async () => {
  const input = { mode: "demo" as const, createdBy: "human:test" as const, now: 5 };
  await expect(
    createProject(db, { ...input, clientName: "x".repeat(81), projectName: "P" }),
  ).rejects.toThrow();
  await expect(createProject(db, { ...input, clientName: "C", projectName: "" })).rejects.toThrow();
});
