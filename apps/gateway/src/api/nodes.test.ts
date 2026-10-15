// Route 6 (GET /api/projects/:id/nodes/:nodeId) through the real gateway against the real FalkorDB
// from docker-compose.yml, on set A's kickoff notes. No mocks.
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  NodeResponse,
  loadConfig,
  type DocumentInfo,
  type ProjectInfo,
} from "@agencymem/contracts";
import { close, connect, type FalkorDB } from "@agencymem/graph";
import { deleteTestClient } from "@agencymem/memory";
import { createEvents } from "../events/bus";
import { createGateway } from "../main";

const TOKENS = { AM_AGENT_TOKEN: "agent-t", AM_UI_TOKEN: "ui-t", AM_HOOK_TOKEN: "hook-t" };
const FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../simulator/fixtures");
const UNKNOWN = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const headers = { "X-AM-Token": "ui-t", "X-AM-Actor": "human:ana" };

let db: FalkorDB;
let server: Server;
let base: string;
let uploads: string;
const graphs = new Set<string>();

beforeAll(async () => {
  db = await connect(FALKORDB_URL);
  uploads = await mkdtemp(join(tmpdir(), "uploads-"));
  const cfg = loadConfig({ ...TOKENS, FALKORDB_URL, UPLOADS_DIR: uploads }, "gateway");
  server = createGateway(cfg, { events: createEvents() });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  for (const graph of graphs) await deleteTestClient(db, graph);
  await close();
  await rm(uploads, { recursive: true, force: true });
});

async function create(clientName: string): Promise<ProjectInfo> {
  const res = await fetch(`${base}/api/projects`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ clientName, projectName: "Booking", mode: "demo" }),
  });
  const { project } = (await res.json()) as { project: ProjectInfo };
  graphs.add(`client_${project.clientId}`);
  return project;
}

const get = async (projectId: string, nodeId: string) => {
  const res = await fetch(`${base}/api/projects/${projectId}/nodes/${nodeId}`, { headers });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

describe("GET /api/projects/:id/nodes/:nodeId", () => {
  it("returns a Document with its Episodes in page and line order, titled by page and lines", async () => {
    const project = await create(`test-client-${randomUUID()}`);
    const form = new FormData();
    const pdf = await readFile(join(FIXTURES, "A", "kickoff-notes.pdf"));
    form.append("files", new Blob([pdf]), "kickoff-notes.pdf");
    const up = await fetch(`${base}/api/projects/${project.id}/files`, {
      method: "POST",
      headers,
      body: form,
    });
    const [doc] = ((await up.json()) as { documents: DocumentInfo[] }).documents;

    const res = await get(project.id, doc!.id);
    expect(res.status).toBe(200);
    const { node, links } = NodeResponse.parse(res.body);
    expect(node).toMatchObject({ label: "Document", id: doc!.id, name: "kickoff-notes.pdf" });
    const episodes = links.filter((l) => l.otherLabel === "Episode");
    expect(episodes).toHaveLength(doc!.episodeCount);
    for (const link of episodes) {
      expect(link).toMatchObject({ type: "PART_OF", direction: "in" });
      expect(link.otherTitle).toMatch(/^p\d+ · l\d+-\d+$/);
    }
    expect(episodes[0]!.otherTitle).toMatch(/^p1 · l1-/);
    const order = episodes.map((l) =>
      l.otherTitle
        .match(/^p(\d+) · l(\d+)/)!
        .slice(1)
        .map(Number),
    );
    expect(order).toEqual([...order].sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!));
  });

  it("answers 404 for an unknown node and 403 FOREIGN_NODE for another project's node", async () => {
    const clientName = `test-client-${randomUUID()}`;
    const one = await create(clientName);
    const two = await create(clientName); // same client, same graph
    expect((await get(one.id, UNKNOWN)).status).toBe(404);
    expect((await get(one.id, "nope")).status).toBe(400);

    const { body } = await fetch(`${base}/api/projects/${one.id}/gates`, { headers }).then(
      async (r) => ({ body: (await r.json()) as { gates: { id: string }[] } }),
    );
    const foreign = await get(two.id, body.gates[0]!.id);
    expect(foreign.status).toBe(403);
    expect(foreign.body).toMatchObject({ error: { details: { reasonCode: "FOREIGN_NODE" } } });
  });
});
