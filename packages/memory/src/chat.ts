// Chat on the documents (route 21). One Cypher query.
import { Episode, text, type Actor } from "@agencymem/contracts";
import { writeQuery } from "@agencymem/graph/write";
import { ulid } from "ulid";
import type { Ctx } from "./ctx";

/** T12: the human_edit Episode with the person's words. */
export async function writeHumanEdit(
  ctx: Ctx,
  input: { text: string; createdBy: Actor; now: number },
): Promise<Episode> {
  const rows = await writeQuery<{ e: { properties: Record<string, unknown> } }>(
    ctx.db,
    ctx.graph,
    "write/write-human-edit",
    {
      projectId: ctx.projectId,
      id: ulid(),
      text: text(2000).min(1).parse(input.text), // checked before it is written
      createdBy: input.createdBy,
      now: input.now,
    },
  );
  if (!rows[0]) throw new Error("write-human-edit returned no row");
  return Episode.parse(rows[0].e.properties);
}
