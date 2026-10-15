// Documents, their Episodes, and the project's Gates. Each function is one Cypher query.
import {
  Document,
  Gate,
  text,
  type Actor,
  type DocumentStatus,
  type GateKey,
} from "@agencymem/contracts";
import { writeQuery } from "@agencymem/graph/write";
import { monotonicFactory, ulid } from "ulid";
import type { Ctx } from "./ctx";

// Monotonic, so the Documents of one upload sort in upload order by id (read/documents.cypher).
const documentId = monotonicFactory();

type Props = { properties: Record<string, unknown> };

export type EpisodeInput = { page: number; lineStart: number; lineEnd: number; text: string };

/**
 * Writes an uploaded file: its Document and all its Episodes (PART_OF) in one query. A file with a
 * sha256 the project already has returns that Document with `created: false` and writes nothing.
 */
export async function writeDocument(
  ctx: Ctx,
  input: {
    name: string;
    mime: string;
    sha256: string;
    status: Extract<DocumentStatus, "processed" | "no_text" | "failed">;
    wordCount: number;
    error: string | null;
    episodes: EpisodeInput[];
    createdBy: Actor;
    now: number;
  },
): Promise<{ document: Document; created: boolean; episodeIds: string[] }> {
  const episodes = input.episodes.map((e) => ({
    id: ulid(),
    ...e,
    text: text(2000).parse(e.text),
  }));
  const rows = await writeQuery<{ d: Props; created: boolean }>(
    ctx.db,
    ctx.graph,
    "write/write-episodes",
    {
      projectId: ctx.projectId,
      id: documentId(),
      name: text(200).min(1).parse(input.name), // checked before it is written
      mime: input.mime,
      sha256: input.sha256,
      status: input.status,
      episodeCount: episodes.length,
      wordCount: input.wordCount,
      error: input.error,
      episodes,
      createdBy: input.createdBy,
      now: input.now,
    },
  );
  const row = rows[0];
  if (!row) throw new Error("write-episodes returned no row");
  return {
    document: Document.parse(row.d.properties),
    created: row.created,
    episodeIds: row.created ? episodes.map((e) => e.id) : [],
  };
}

/** Creates the Gates of `keys` that the project does not have yet. Returns the new ones. */
export async function createGates(
  ctx: Ctx,
  input: { keys: GateKey[]; createdBy: Actor; now: number },
): Promise<Gate[]> {
  const rows = await writeQuery<{ x: Props }>(ctx.db, ctx.graph, "write/create-gates", {
    projectId: ctx.projectId,
    gates: input.keys.map((key) => ({ key, id: ulid() })),
    createdBy: input.createdBy,
    now: input.now,
  });
  return rows.map((r) => Gate.parse(r.x.properties));
}
