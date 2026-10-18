// A person's question on the Memory screen: the ask Episode and its ask WorkItem, one query.
import { Episode, WorkItem, text, type Actor } from "@agencymem/contracts";
import { writeQuery } from "@agencymem/graph/write";
import { ulid } from "ulid";
import type { Ctx } from "./ctx";

type Props = { properties: Record<string, unknown> };

export async function askProject(
  ctx: Ctx,
  input: { text: string; createdBy: Actor; now: number },
): Promise<{ episode: Episode; item: WorkItem }> {
  const rows = await writeQuery<{ e: Props; w: Props }>(ctx.db, ctx.graph, "write/ask", {
    projectId: ctx.projectId,
    episodeId: ulid(),
    itemId: ulid(),
    text: text(1000).min(1).parse(input.text), // checked before it is written
    createdBy: input.createdBy,
    now: input.now,
  });
  const row = rows[0];
  if (!row) throw new Error("ask returned no row");
  return { episode: Episode.parse(row.e.properties), item: WorkItem.parse(row.w.properties) };
}
