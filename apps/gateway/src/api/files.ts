// Routes 4 and 5 of contracts.md section 8: upload files, list a project's documents. An upload
// stores each file by its sha256, turns it into episodes with packages/ingest, writes the Document
// and its Episodes in one query, then runs the stage machine (T2).
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import express, { type Request, type Response, type Router } from "express";
import multer from "multer";
import {
  Document,
  Id,
  UPLOAD_RULES,
  type DocumentInfo,
  type PersonActor,
  type Rejection,
} from "@agencymem/contracts";
import { UnknownProjectError, graphFor, readQuery, type FalkorDB } from "@agencymem/graph";
import { ingest } from "@agencymem/ingest";
import { writeDocument, type Ctx } from "@agencymem/memory";
import type { Events } from "../events/bus";
import { reject, rejectAndCount } from "../mcp/guards";
import { runStage } from "../stage/effects";
import { readStageState } from "../stage/state";
import { MISSING_ACTOR, personActor, sendError } from "./http";

const TOOL = "POST /api/projects/:id/files";
const NO_TEXT = "no text found"; // ui.md, Files screen

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".md": "text/markdown",
};

// ponytail: files are held in memory (at most 10 x 10 MB per request) until they are hashed and
// stored; stream to disk if uploads grow.
const parseFiles = multer({
  storage: multer.memoryStorage(),
  limits: { files: UPLOAD_RULES.maxFiles, fileSize: UPLOAD_RULES.maxBytes },
  defParamCharset: "utf8", // multer reads file names as latin1 by default
}).array(UPLOAD_RULES.field, UPLOAD_RULES.maxFiles);

const invalid = (reason: string): Rejection => ({ code: "VALIDATION_FAILED", reason });

function toInfo(d: Document): DocumentInfo {
  return {
    id: d.id,
    name: d.name,
    mime: d.mime,
    status: d.status,
    episodeCount: d.episodeCount,
    wordCount: d.wordCount,
    error: d.error,
    uploadedAt: d.uploadedAt,
  };
}

/** The project of the path and its graph, or the rejection to send. */
async function project(
  db: FalkorDB,
  raw: string | undefined,
): Promise<{ ok: true; id: string; graph: string } | { ok: false; error: Rejection }> {
  const id = Id.safeParse(raw);
  if (!id.success) return { ok: false, error: invalid("The project id is not an id.") };
  try {
    return { ok: true, id: id.data, graph: await graphFor(db, id.data) };
  } catch (e) {
    if (!(e instanceof UnknownProjectError)) throw e;
    return { ok: false, error: { code: "NOT_FOUND", reason: `Unknown project ${id.data}.` } };
  }
}

/** Every file of the request is checked before any is stored: one bad file refuses them all. */
function checkFiles(files: Express.Multer.File[]): Rejection | null {
  if (files.length === 0) return invalid(`Send 1 to ${UPLOAD_RULES.maxFiles} files in "files".`);
  for (const f of files) {
    const ext = extname(f.originalname).toLowerCase();
    if (!(UPLOAD_RULES.extensions as readonly string[]).includes(ext)) {
      return invalid(
        `${f.originalname}: only ${UPLOAD_RULES.extensions.join(" ")} files are accepted.`,
      );
    }
    if (f.originalname.length > 200)
      return invalid(`${f.originalname}: the name is over 200 characters.`);
  }
  return null;
}

/** Multer's own limits (file count, size, field name) as a 400, never Express's error page. */
function parse(req: Request, res: Response): Promise<Rejection | null> {
  return new Promise((resolve) =>
    parseFiles(req, res, (err: unknown) => {
      if (!err) return resolve(null);
      const message = err instanceof multer.MulterError ? err.message : "The upload is not valid.";
      resolve(invalid(`${message} (at most ${UPLOAD_RULES.maxFiles} files of 10 MB each).`));
    }),
  );
}

async function store(
  ctx: Ctx,
  file: Express.Multer.File,
  dir: string,
  createdBy: PersonActor,
  now: number,
) {
  const sha256 = createHash("sha256").update(file.buffer).digest("hex");
  await writeFile(join(dir, sha256), file.buffer); // same name, same content: safe to overwrite
  let result: Awaited<ReturnType<typeof ingest>> | null = null;
  let error: string | null = null;
  try {
    result = await ingest({ name: file.originalname, data: file.buffer });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e); // the file could not be read: failed
  }
  return writeDocument(ctx, {
    name: file.originalname,
    mime: MIME[extname(file.originalname).toLowerCase()]!,
    sha256,
    status: result?.status ?? "failed",
    wordCount: result?.wordCount ?? 0,
    error: result?.status === "no_text" ? NO_TEXT : error,
    episodes: result?.episodes ?? [],
    createdBy,
    now,
  });
}

export function filesRouter(deps: {
  db: () => Promise<FalkorDB>;
  events: Events;
  uploadsDir: string;
}): Router {
  const router = express.Router();

  // 4. POST /api/projects/:id/files
  router.post("/projects/:id/files", async (req, res) => {
    const actor = personActor(req);
    if (!actor) return sendError(res, MISSING_ACTOR);
    const db = await deps.db();
    const found = await project(db, req.params.id);
    if (!found.ok) return sendError(res, found.error);

    // T2: uploads only while the stage is intake; after that, new information is a change request.
    // ponytail: the stage check and the Document write are separate queries (the Project is in the
    // registry graph, the Document in the client graph), so a T3 committing in between lets one
    // upload land in discovery. Re-check the stage before runStage if that ever matters.
    const state = await readStageState(db, found.id, found.graph);
    if (state && state.stage !== "intake") {
      const refused = reject(
        "gate",
        "WRONG_STAGE",
        `Uploads are closed: the project is in ${state.stage}. Use a change request instead.`,
        { stage: state.stage },
      );
      const at = { events: deps.events, tool: TOOL, agent: actor };
      return sendError(res, await rejectAndCount(db, found.id, refused, at));
    }

    const parseError = await parse(req, res);
    if (parseError) return sendError(res, parseError);
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const bad = checkFiles(files);
    if (bad) return sendError(res, bad);

    const dir = join(deps.uploadsDir, found.id);
    await mkdir(dir, { recursive: true });
    const ctx: Ctx = { db, graph: found.graph, projectId: found.id };
    const now = Date.now();
    const documents: DocumentInfo[] = [];
    const created: Document[] = [];
    for (const file of files) {
      const { document, created: isNew, episodeIds } = await store(ctx, file, dir, actor, now);
      documents.push(toInfo(document));
      if (!isNew) continue; // the project already has this file
      created.push(document);
      deps.events.emit(found.id, "node.written", {
        label: "Document",
        id: document.id,
        version: document.version,
        // No file name here: a name may be 200 characters and the summary only 120.
        summary: `Document ${document.status}, ${document.episodeCount} episodes`,
        ids: [document.id, ...episodeIds],
      });
    }

    await runStage(db, deps.events, found.id, {
      type: "files_uploaded",
      actor,
      documents: created.map((d) => ({ id: d.id, status: d.status })),
    });
    res.status(201).json({ documents });
  });

  // 5. GET /api/projects/:id/documents (snapshot), in upload order.
  router.get("/projects/:id/documents", async (req, res) => {
    const db = await deps.db();
    const found = await project(db, req.params.id);
    if (!found.ok) return sendError(res, found.error);
    const seq = deps.events.current(found.id); // read before the snapshot (C12)
    const rows = await readQuery<{ d: { properties: Record<string, unknown> } }>(
      db,
      found.graph,
      "read/documents",
      { projectId: found.id },
    );
    res.json({ documents: rows.map((r) => toInfo(Document.parse(r.d.properties))), seq });
  });

  return router;
}
