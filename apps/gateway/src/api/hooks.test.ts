// POST /hooks/commit (contracts.md section 9, stage-machine.md T17) through the real gateway
// against the real FalkorDB from docker-compose.yml. No mocks. The Done when check, a real git
// commit through the installed hook, is tests/runner/commit-hook.test.ts.
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type Envelope } from "@agencymem/contracts";
import { close, connect, readQuery, type FalkorDB } from "@agencymem/graph";
import {
  createProject,
  deleteTestClient,
  setStage,
  writeCards,
  writeDocument,
  writeFacts,
  writeProduct,
  writeVersioned,
  type Ctx,
} from "@agencymem/memory";
import { createEvents } from "../events/bus";
import { createGateway } from "../main";

const TOKENS = { AM_AGENT_TOKEN: "agent-t", AM_UI_TOKEN: "ui-t", AM_HOOK_TOKEN: "hook-t" };
const FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";

let db: FalkorDB;
let server: Server;
let base: string;
const events = createEvents();
const graphs = new Set<string>();

beforeAll(async () => {
  db = await connect(FALKORDB_URL);
  server = createGateway(loadConfig({ ...TOKENS, FALKORDB_URL }, "gateway"), { events });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  for (const graph of graphs) await deleteTestClient(db, graph);
  await close();
});

/** A project in build with CARD-01 (In progress) and CARD-02 (Ready). */
async function setup(): Promise<{ ctx: Ctx; ids: string[] }> {
  const now = Date.now();
  const { project, client } = await createProject(db, {
    clientName: `test-client-${randomUUID()}`,
    projectName: "Hooks",
    mode: "demo",
    createdBy: "human:test",
    now,
  });
  const ctx: Ctx = { db, graph: `client_${client.id}`, projectId: project.id };
  graphs.add(ctx.graph);
  await setStage(db, project.id, "intake", "build");
  const { episodeIds } = await writeDocument(ctx, {
    name: "notes.pdf",
    mime: "application/pdf",
    sha256: "a".repeat(64),
    status: "processed",
    wordCount: 3,
    error: null,
    episodes: [{ page: 1, lineStart: 1, lineEnd: 1, text: "One rule." }],
    createdBy: "human:test",
    now,
  });
  const { factIds } = await writeFacts(ctx, {
    entities: [{ key: "clinic", name: "Clinic", aliases: [] }],
    facts: [
      {
        statement: "Rule 1 is A.",
        subject: "clinic",
        attribute: "rule_1",
        value: "A",
        episodeIds,
        replacesFactId: null,
      },
    ],
    createdBy: "intake",
    now,
  });
  await writeProduct(ctx, {
    baseVersion: 0,
    requirements: [{ key: "REQ-01", text: "A patient can book.", priority: "must", factIds }],
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
  const card = (n: number) => ({
    key: `CARD-0${n}`,
    title: `Card ${n}`,
    description: `Builds part ${n}.`,
    lane: "Backend",
    order: n * 10,
    requirementKey: "REQ-01",
    designKeys: [],
    dependsOn: [],
    criteria: [
      { key: `AC-0${n}-1`, text: `Given ${n}, when it runs, then it works.`, testIds: [] },
    ],
  });
  const { taskIds } = (await writeCards(ctx, {
    cards: [card(1), card(2)] as never,
    createdBy: "planner",
    now,
  }))!;
  await put(ctx, taskIds[0]!, { column: "In progress" });
  await put(ctx, taskIds[1]!, { column: "Ready" });
  return { ctx, ids: taskIds };
}

async function put(ctx: Ctx, id: string, props: Record<string, string | number | null>) {
  const [row] = await readQuery<{ n: { properties: { version: number } } }>(
    db,
    ctx.graph,
    "read/node",
    { id },
  );
  await writeVersioned(ctx, { id, version: row!.n.properties.version, props });
}

const node = async (ctx: Ctx, id: string) =>
  (
    await readQuery<{ n: { properties: Record<string, unknown> } }>(db, ctx.graph, "read/node", {
      id,
    })
  )[0]!.n.properties;

let shas = 0;
const sha = () => (++shas).toString(16).padStart(40, "c");

async function commit(body: Record<string, unknown>, token = "hook-t") {
  const res = await fetch(`${base}/hooks/commit`, {
    method: "POST",
    headers: { "X-AM-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({
      files: ["src/booking.ts"],
      message: "feat(CARD-01): book a slot",
      author: "agencymem",
      committedAt: 1_792_000_000_000,
      ...body,
    }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("POST /hooks/commit", () => {
  it("records a build commit, links it to its card, moves the card to Testing and opens a test_run (T17)", async () => {
    const { ctx, ids } = await setup();
    const sent: Envelope[] = [];
    const off = events.on((e) => e.projectId === ctx.projectId && sent.push(e));
    const s = sha();
    const res = await commit({ projectId: ctx.projectId, sha: s, branch: "card/CARD-01" });
    off();

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ linked: true, taskId: ids[0] });
    const { codeChangeId, workItemId } = res.body as { codeChangeId: string; workItemId: string };
    expect(await node(ctx, codeChangeId)).toMatchObject({
      sha: s,
      branch: "card/CARD-01",
      files: ["src/booking.ts"],
      message: "feat(CARD-01): book a slot",
      author: "agencymem",
      committedAt: 1_792_000_000_000,
      linked: true,
      createdBy: "build",
    });
    expect(await node(ctx, ids[0]!)).toMatchObject({ column: "Testing" });
    expect(await node(ctx, workItemId)).toMatchObject({
      kind: "test_run",
      status: "open",
      subjectId: codeChangeId,
      createdBy: "build",
    });
    expect(sent.map((e) => [e.type, (e.data as { label?: string }).label ?? null])).toEqual([
      ["node.written", "CodeChange"],
      ["task.moved", null],
      ["node.written", "WorkItem"],
    ]);
    expect(sent[1]!.data).toMatchObject({ taskId: ids[0], from: "In progress", to: "Testing" });
  });

  it("tests each new build commit on a card already in Testing, without moving it again", async () => {
    const { ctx, ids } = await setup();
    await commit({ projectId: ctx.projectId, sha: sha(), branch: "card/CARD-01" });
    const version = (await node(ctx, ids[0]!)).version;
    const sent: Envelope[] = [];
    const off = events.on((e) => e.projectId === ctx.projectId && sent.push(e));
    const second = await commit({ projectId: ctx.projectId, sha: sha(), branch: "card/CARD-01" });
    off();

    expect(second.body).toMatchObject({ linked: true, taskId: ids[0] });
    expect((second.body as { workItemId: string | null }).workItemId).not.toBeNull();
    expect(await node(ctx, ids[0]!)).toMatchObject({ column: "Testing", version });
    expect(sent.map((e) => e.type)).toEqual(["node.written", "node.written"]); // no task.moved
  });

  it("returns the first record for the same sha, with no second item or event", async () => {
    const { ctx } = await setup();
    const s = sha();
    const first = await commit({ projectId: ctx.projectId, sha: s, branch: "card/CARD-01" });
    const sent: Envelope[] = [];
    const off = events.on((e) => e.projectId === ctx.projectId && sent.push(e));
    const again = await commit({ projectId: ctx.projectId, sha: s, branch: "card/CARD-01" });
    off();
    expect(again).toEqual({
      status: 202,
      body: { ...first.body, workItemId: null },
    });
    expect(sent).toEqual([]);
  });

  it("links but does not test a commit by agencymem-test or on a card not being built", async () => {
    const { ctx, ids } = await setup();
    const spec = await commit({
      projectId: ctx.projectId,
      sha: sha(),
      branch: "card/CARD-01",
      author: "agencymem-test",
    });
    expect(spec.body).toMatchObject({ linked: true, taskId: ids[0], workItemId: null });
    const codeChange = await node(ctx, (spec.body as { codeChangeId: string }).codeChangeId);
    expect(codeChange.createdBy).toBe("test");
    expect(await node(ctx, ids[0]!)).toMatchObject({ column: "In progress" });

    const ready = await commit({ projectId: ctx.projectId, sha: sha(), branch: "card/CARD-02" });
    expect(ready.body).toMatchObject({ linked: true, taskId: ids[1], workItemId: null });
    expect(await node(ctx, ids[1]!)).toMatchObject({ column: "Ready" });
  });

  it("records a commit on another branch, or on a card that does not exist, as unlinked", async () => {
    const { ctx } = await setup();
    for (const branch of ["main", "feature/x", "card/CARD-09"]) {
      const res = await commit({ projectId: ctx.projectId, sha: sha(), branch });
      expect(res).toMatchObject({
        status: 202,
        body: { linked: false, taskId: null, workItemId: null },
      });
    }
  });

  it("refuses a wrong token (401), a bad body (400) and an unknown project (404)", async () => {
    const { ctx } = await setup();
    expect(
      (await commit({ projectId: ctx.projectId, sha: sha(), branch: "main" }, "agent-t")).status,
    ).toBe(401);
    expect((await commit({ projectId: ctx.projectId, sha: "nope", branch: "main" })).status).toBe(
      400,
    );
    expect(
      (await commit({ projectId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", sha: sha(), branch: "main" }))
        .status,
    ).toBe(404);
  });
});
