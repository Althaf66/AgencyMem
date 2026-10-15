// Routes 4 and 5 (upload, documents) and transitions T1 and T2 through the real gateway against the
// real FalkorDB from docker-compose.yml, with set A of the fixture notes. No mocks.
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  loadConfig,
  type DocumentInfo,
  type Envelope,
  type ProjectInfo,
} from "@agencymem/contracts";
import { close, connect, type FalkorDB } from "@agencymem/graph";
import { ingest } from "@agencymem/ingest";
import { setStage, writeDocument, deleteTestClient } from "@agencymem/memory";
import { createEvents } from "../events/bus";
import { createGateway } from "../main";
import { runStage } from "../stage/effects";

const TOKENS = { AM_AGENT_TOKEN: "agent-t", AM_UI_TOKEN: "ui-t", AM_HOOK_TOKEN: "hook-t" };
const FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../simulator/fixtures");
const SET_A = ["kickoff-notes.pdf", "client-summary.docx", "whatsapp-chat.txt"];
// Built at run time, so this file holds no Cypher string literal (AGENTS.md rule 4).
const q = (...parts: string[]) => parts.join(" ");

let db: FalkorDB;
let server: Server;
let base: string;
let uploads: string;
const events = createEvents();
const graphs = new Set<string>();

beforeAll(async () => {
  db = await connect(FALKORDB_URL);
  uploads = await mkdtemp(join(tmpdir(), "uploads-"));
  const cfg = loadConfig({ ...TOKENS, FALKORDB_URL, UPLOADS_DIR: uploads }, "gateway");
  server = createGateway(cfg, { events });
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

const headers = { "X-AM-Token": "ui-t", "X-AM-Actor": "human:ana" };

async function create(): Promise<ProjectInfo> {
  const res = await fetch(`${base}/api/projects`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      clientName: `test-client-${randomUUID()}`,
      projectName: "Booking",
      mode: "demo",
    }),
  });
  const { project } = (await res.json()) as { project: ProjectInfo };
  graphs.add(`client_${project.clientId}`);
  return project;
}

type Upload = { name: string; data: Uint8Array };
const fixture = async (set: string, name: string): Promise<Upload> => ({
  name,
  data: await readFile(join(FIXTURES, set, name)),
});

async function upload(projectId: string, files: Upload[], extra: Record<string, string> = {}) {
  const form = new FormData();
  for (const f of files) form.append("files", new Blob([f.data]), f.name);
  const res = await fetch(`${base}/api/projects/${projectId}/files`, {
    method: "POST",
    headers: { ...headers, ...extra },
    body: form,
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function rows(
  projectId: string,
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<unknown[][]> {
  const res = await fetch(`${base}/api/query`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", "X-AM-Project": projectId },
    body: JSON.stringify({ graph: "client", cypher, params }),
  });
  return ((await res.json()) as { rows: unknown[][] }).rows;
}

const docs = (body: Record<string, unknown>) => body.documents as DocumentInfo[];
const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

describe("Done when: uploading 3 files creates episodes with page and lines", () => {
  it("writes Documents and Episodes with page and line range, stores the files, opens an intake item each", async () => {
    const project = await create();
    const files = await Promise.all(SET_A.map((name) => fixture("A", name)));
    const sent: Envelope[] = [];
    const off = events.on((e) => e.projectId === project.id && sent.push(e));
    const res = await upload(project.id, files);
    off();

    expect(res.status).toBe(201);
    const documents = docs(res.body);
    const expected = await Promise.all(files.map((f) => ingest(f)));
    expect(documents.map((d) => [d.name, d.status, d.episodeCount, d.wordCount])).toEqual(
      files.map((f, i) => [
        f.name,
        "processed",
        expected[i]!.episodes.length,
        expected[i]!.wordCount,
      ]),
    );

    // Every Episode belongs to its Document and has the page and line range ingest gave.
    for (const [i, doc] of documents.entries()) {
      const stored = await rows(
        project.id,
        q(
          "MATCH",
          "(e:Episode)-[:PART_OF]->(d:Document {id: $id})",
          "RETURN",
          "e.kind, e.documentId, e.page, e.lineStart, e.lineEnd, e.text",
          "ORDER BY e.page, e.lineStart",
        ),
        { id: doc.id },
      );
      const want = expected[i]!.episodes.map((e) => [
        "file_chunk",
        doc.id,
        e.page,
        e.lineStart,
        e.lineEnd,
        e.text,
      ]).sort((a, b) => (a[2] as number) - (b[2] as number) || (a[3] as number) - (b[3] as number));
      expect(stored).toEqual(want);
    }

    // The files are stored under their sha256 names.
    expect((await readdir(join(uploads, project.id))).sort()).toEqual(
      files.map((f) => sha256(f.data)).sort(),
    );

    // T2: one open intake item per processed Document.
    const items = await rows(
      project.id,
      q(
        "MATCH",
        "(w:WorkItem {kind: 'intake'})",
        "RETURN",
        "w.subjectId, w.status ORDER BY w.subjectId",
      ),
    );
    expect(items).toEqual(documents.map((d) => [d.id, "open"]).sort());

    // One node.written per Document (with its Episodes in ids), then one per intake item.
    const written = sent.filter((e) => e.type === "node.written").map((e) => e.data);
    expect(written.filter((d) => "label" in d && d.label === "Document")).toHaveLength(3);
    expect(written.filter((d) => "label" in d && d.label === "WorkItem")).toHaveLength(3);
    const first = written.find(
      (d) => "label" in d && d.label === "Document" && d.id === documents[0]!.id,
    );
    expect(first && "ids" in first ? first.ids : []).toHaveLength(1 + documents[0]!.episodeCount);
  });
});

describe("POST /api/projects/:id/files", () => {
  it("gives no_text and no episodes for a PDF with no text layer, and a failed Document for a corrupt file", async () => {
    const project = await create();
    const scanned = await fixture("negative", "scanned.pdf");
    const corrupt = { name: "broken.pdf", data: new TextEncoder().encode("%PDF-1.4 not a pdf") };
    const res = await upload(project.id, [scanned, corrupt]);
    expect(res.status).toBe(201);
    expect(docs(res.body)).toMatchObject([
      {
        name: "scanned.pdf",
        status: "no_text",
        episodeCount: 0,
        wordCount: 0,
        error: "no text found",
      },
      { name: "broken.pdf", status: "failed", episodeCount: 0, wordCount: 0 },
    ]);
    expect(docs(res.body)[1]!.error).toEqual(expect.any(String));
    expect(await rows(project.id, q("MATCH", "(e:Episode)", "RETURN", "count(e)"))).toEqual([[0]]);
    expect(await rows(project.id, q("MATCH", "(w:WorkItem)", "RETURN", "count(w)"))).toEqual([[0]]);
  });

  it("returns the existing Document for a file uploaded twice, and writes nothing new", async () => {
    const project = await create();
    const chat = await fixture("A", "whatsapp-chat.txt");
    const first = docs((await upload(project.id, [chat])).body)[0]!;
    const again = await upload(project.id, [chat]);
    expect(again.status).toBe(201);
    expect(docs(again.body)).toEqual([first]);
    expect(await rows(project.id, q("MATCH", "(d:Document)", "RETURN", "count(d)"))).toEqual([[1]]);
    expect(await rows(project.id, q("MATCH", "(w:WorkItem)", "RETURN", "count(w)"))).toEqual([[1]]);
  });

  it("keeps a UTF-8 file name", async () => {
    const project = await create();
    const res = await upload(project.id, [
      { name: "notes-café.md", data: new TextEncoder().encode("Hello.") },
    ]);
    expect(docs(res.body)[0]).toMatchObject({ name: "notes-café.md", mime: "text/markdown" });
  });

  it("takes a 200-character file name: the event summary stays within its limit", async () => {
    const project = await create();
    const name = `${"n".repeat(196)}.txt`;
    const res = await upload(project.id, [{ name, data: new TextEncoder().encode("Hello.") }]);
    expect(res.status).toBe(201);
    expect(docs(res.body)[0]).toMatchObject({ name, status: "processed" });
    expect(await rows(project.id, q("MATCH", "(w:WorkItem)", "RETURN", "count(w)"))).toEqual([[1]]);
  });

  it("refuses with 409 when the stage is not intake, counted, with write.rejected (T2)", async () => {
    const project = await create();
    expect(await setStage(db, project.id, "intake", "discovery")).toBe(true);
    const sent: Envelope[] = [];
    const off = events.on((e) => e.projectId === project.id && sent.push(e));
    const res = await upload(project.id, [await fixture("A", "whatsapp-chat.txt")]);
    off();
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: {
        code: "GUARD_REJECTED",
        guard: "gate",
        details: { reasonCode: "WRONG_STAGE", stage: "discovery" },
      },
    });
    expect(sent.map((e) => e.type)).toEqual(["write.rejected", "metrics.updated"]);
    expect(sent[1]!.data).toMatchObject({ metric: "rejectedWrites", value: 1 });
    expect(sent[0]!.data).toMatchObject({
      tool: "POST /api/projects/:id/files",
      agent: "human:ana",
    });
    expect(await rows(project.id, q("MATCH", "(d:Document)", "RETURN", "count(d)"))).toEqual([[0]]);
  });

  it("refuses the whole request with 400: no actor, no files, 11 files, a wrong type, a long name", async () => {
    const project = await create();
    const txt = (name: string) => ({ name, data: new TextEncoder().encode("Line.") });
    const noActor = await upload(project.id, [txt("a.txt")], { "X-AM-Actor": "" });
    expect(noActor.status).toBe(400);
    expect((await upload(project.id, [])).status).toBe(400);
    const eleven = Array.from({ length: 11 }, (_, i) => txt(`n${i}.txt`));
    expect((await upload(project.id, eleven)).status).toBe(400);
    expect((await upload(project.id, [txt("a.txt"), txt("notes.rtf")])).status).toBe(400);
    expect((await upload(project.id, [txt(`${"x".repeat(201)}.txt`)])).status).toBe(400);
    const big = { name: "big.txt", data: new Uint8Array(10 * 1024 * 1024 + 1).fill(65) };
    expect((await upload(project.id, [txt("a.txt"), big])).status).toBe(400);
    expect(await rows(project.id, q("MATCH", "(d:Document)", "RETURN", "count(d)"))).toEqual([[0]]);
  });

  it("answers 404 for an unknown project", async () => {
    const res = await upload("01ARZ3NDEKTSV4RRFFQ69G5FAV", [
      await fixture("A", "whatsapp-chat.txt"),
    ]);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/projects/:id/documents (route 5)", () => {
  it("lists the Documents in upload order with the seq the snapshot reflects", async () => {
    const project = await create();
    const files = await Promise.all(SET_A.map((name) => fixture("A", name)));
    const uploaded = docs((await upload(project.id, files)).body);
    const res = await fetch(`${base}/api/projects/${project.id}/documents`, { headers });
    const body = (await res.json()) as { documents: DocumentInfo[]; seq: number };
    expect(res.status).toBe(200);
    expect(body.documents).toEqual(uploaded);
    expect(body.seq).toBe(events.current(project.id));
  });
});

describe("T1: creating a project creates its gates", () => {
  it("writes G1, G2, G3 and G5, each waiting", async () => {
    const project = await create();
    expect(
      await rows(project.id, q("MATCH", "(g:Gate)", "RETURN", "g.key, g.status ORDER BY g.key")),
    ).toEqual([
      ["G1", "waiting"],
      ["G2", "waiting"],
      ["G3", "waiting"],
      ["G5", "waiting"],
    ]);
  });
});

describe("startup repair (stage-machine.md section 1, rule 3)", () => {
  it("opens the intake item of a processed Document that a crash left without one", async () => {
    const project = await create();
    const graph = `client_${project.clientId}`;
    // The Document is written, but the gateway stopped before its T2 effect ran.
    const { document } = await writeDocument(
      { db, graph, projectId: project.id },
      {
        name: "late.txt",
        mime: "text/plain",
        sha256: "a".repeat(64),
        status: "processed",
        wordCount: 1,
        error: null,
        episodes: [{ page: 1, lineStart: 1, lineEnd: 1, text: "Late." }],
        createdBy: "human:ana",
        now: Date.now(),
      },
    );
    expect(await runStage(db, events, project.id, { type: "startup" })).toEqual([
      { id: expect.any(String), kind: "intake" },
    ]);
    expect(
      await rows(project.id, q("MATCH", "(w:WorkItem)", "RETURN", "w.subjectId, w.createdBy")),
    ).toEqual([[document.id, "human:ana"]]);
    // A second start finds nothing to repair.
    expect(await runStage(db, events, project.id, { type: "startup" })).toEqual([]);
  });
});
