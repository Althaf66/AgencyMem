// Facts and Entities (write_fact). One Cypher query per call.
import { text, type Actor } from "@agencymem/contracts";
import { writeQuery } from "@agencymem/graph/write";
import { ulid } from "ulid";
import type { Ctx } from "./ctx";

/** An Entity to write: `aliases` is the full list it ends with. */
export type EntityWrite = { key: string; name: string; aliases: string[] };

/** A Fact to write. `subject` is the key of one of the Entities in the same call. */
export type FactWrite = {
  statement: string;
  subject: string;
  attribute: string;
  value: string;
  episodeIds: string[];
  replacesFactId: string | null;
};

/**
 * Writes the Entities and Facts of one write_fact call. A replaced fact gets validTo and the new one
 * SUPERSEDES it; a fact is never deleted (AGENTS.md rule 7). `factIds` follow the order of `facts`;
 * `superseded` pairs each ended fact with the fact that replaced it.
 */
export async function writeFacts(
  ctx: Ctx,
  input: { entities: EntityWrite[]; facts: FactWrite[]; createdBy: Actor; now: number },
): Promise<{ factIds: string[]; entityIds: string[]; superseded: [string, string][] }> {
  const facts = input.facts.map((f) => ({
    ...f,
    id: ulid(),
    episodeIds: [...new Set(f.episodeIds)], // one SOURCED_FROM edge per episode
    statement: text(300).parse(f.statement), // checked before it is written
    value: text(200).parse(f.value),
  }));
  const rows = await writeQuery<{ entityIds: string[]; superseded: [string, string][] }>(
    ctx.db,
    ctx.graph,
    "write/write-facts",
    {
      projectId: ctx.projectId,
      entities: input.entities.map((e) => ({ ...e, id: ulid(), name: text(80).parse(e.name) })),
      facts,
      createdBy: input.createdBy,
      now: input.now,
    },
  );
  const row = rows[0];
  if (!row) throw new Error("write-facts returned no row");
  return { factIds: facts.map((f) => f.id), entityIds: row.entityIds, superseded: row.superseded };
}

/**
 * record_change_request, write 1 (technical design "facts.supersede"), all or nothing: sets the
 * open CR's status, ends each old fact and writes its replacement, SOURCED_FROM the CR's episode.
 * `applied` is false when the CR was not open or an old fact was no longer current; then nothing
 * changed. `newFactIds` follow the order of `changes`.
 */
export async function supersedeFacts(
  ctx: Ctx,
  input: {
    crId: string;
    status: "applied" | "no_change" | "needs_scope";
    changes: { oldFactId: string; statement: string; value: string }[];
    createdBy: Actor;
    now: number;
  },
): Promise<{ newFactIds: string[]; applied: boolean }> {
  const changes = input.changes.map((c) => ({
    oldFactId: c.oldFactId,
    newFactId: ulid(),
    statement: text(300).parse(c.statement), // checked before it is written
    value: text(200).parse(c.value),
  }));
  const rows = await writeQuery<{ status: string; about: number }>(
    ctx.db,
    ctx.graph,
    "write/supersede-fact",
    {
      projectId: ctx.projectId,
      crId: input.crId,
      status: input.status,
      changes,
      createdBy: input.createdBy,
      now: input.now,
    },
  );
  return { newFactIds: changes.map((c) => c.newFactId), applied: rows.length > 0 };
}
