// Change requests (stage-machine.md section 7). Each function is one Cypher query.
import { ChangeRequest, Episode, text, type Actor } from "@agencymem/contracts";
import { writeQuery } from "@agencymem/graph/write";
import { ulid } from "ulid";
import type { Ctx } from "./ctx";

type Props = { properties: Record<string, unknown> };

/** Route 22 (C1): the change_request Episode and the open ChangeRequest FROM it. */
export async function createChangeRequest(
  ctx: Ctx,
  input: { text: string; createdBy: Actor; now: number },
): Promise<{ changeRequest: ChangeRequest; episode: Episode }> {
  const rows = await writeQuery<{ cr: Props; e: Props }>(
    ctx.db,
    ctx.graph,
    "write/create-change-request",
    {
      projectId: ctx.projectId,
      crId: ulid(),
      episodeId: ulid(),
      text: text(2000).min(1).parse(input.text), // checked before it is written
      createdBy: input.createdBy,
      now: input.now,
    },
  );
  const row = rows[0];
  if (!row) throw new Error("create-change-request returned no row");
  return {
    changeRequest: ChangeRequest.parse(row.cr.properties),
    episode: Episode.parse(row.e.properties),
  };
}
