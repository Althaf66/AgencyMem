// The impact flag of a change request (technical design "impact.flag"). One Cypher query.
import type { Column } from "@agencymem/contracts";
import { writeQuery } from "@agencymem/graph/write";
import type { Ctx } from "./ctx";

export type Flagged =
  | {
      label: "Task";
      id: string;
      key: string;
      /** The column the card had; it is in Rework now. */
      from: Column;
      version: number;
      /** The worker whose lease the flag cancelled, if one held it (C5). */
      owner: string | null;
    }
  | { label: "DocSection"; id: string; version: number };

/**
 * Flags every Task and DocSection the facts `factIds` touch (read/impact.cypher's edges): a Task
 * moves to Rework with its lease cleared, a DocSection becomes stale, and each gets FLAGGED_BY the CR.
 */
export async function flagImpact(
  ctx: Ctx,
  input: { crId: string; factIds: string[] },
): Promise<Flagged[]> {
  if (input.factIds.length === 0) return [];
  const rows = await writeQuery<{
    label: "Task" | "DocSection";
    id: string;
    key: string | null;
    from: Column | null;
    version: number;
    owner: string | null;
  }>(ctx.db, ctx.graph, "write/flag-impact", {
    projectId: ctx.projectId,
    crId: input.crId,
    factIds: input.factIds,
  });
  return rows.map((r) =>
    r.label === "Task"
      ? { label: "Task", id: r.id, key: r.key!, from: r.from!, version: r.version, owner: r.owner }
      : { label: "DocSection", id: r.id, version: r.version },
  );
}
