// The board's cards (write_cards). One Cypher query per call.
import { WorkItem, text, type Actor, type Lane } from "@agencymem/contracts";
import { writeQuery } from "@agencymem/graph/write";
import { ulid } from "ulid";
import type { Ctx } from "./ctx";

export type CardWrite = {
  key: string;
  title: string;
  description: string;
  lane: Lane;
  order: number;
  requirementKey: string;
  designKeys: string[];
  /** Keys of other cards in the same call. */
  dependsOn: string[];
  criteria: { key: string; text: string; testIds: string[] }[];
};

/**
 * Creates the cards as build Tasks in Backlog with their criteria and edges. Ids follow the input
 * order (criteria card by card). Null when a card key already exists or a requirement is no longer
 * current; nothing is written then.
 */
export async function writeCards(
  ctx: Ctx,
  input: { cards: CardWrite[]; createdBy: Actor; now: number },
): Promise<{ taskIds: string[]; criterionIds: string[] } | null> {
  const cards = input.cards.map((c) => ({
    ...c,
    id: ulid(),
    title: text(80).parse(c.title), // checked before it is written
    description: text(1200).parse(c.description),
    designKeys: [...new Set(c.designKeys)],
    criteria: c.criteria.map((k) => ({ ...k, id: ulid(), text: text(300).parse(k.text) })),
  }));
  const idOf = new Map(cards.map((c) => [c.key, c.id]));
  const rows = await writeQuery(ctx.db, ctx.graph, "write/write-cards", {
    projectId: ctx.projectId,
    keys: cards.map((c) => c.key),
    cards,
    edges: cards.flatMap((c) =>
      [...new Set(c.dependsOn)].map((key) => ({ from: c.id, to: idOf.get(key)! })),
    ),
    createdBy: input.createdBy,
    now: input.now,
  });
  if (!rows[0]) return null;
  return {
    taskIds: cards.map((c) => c.id),
    criterionIds: cards.flatMap((c) => c.criteria.map((k) => k.id)),
  };
}

export type CriterionWrite = { key: string; text: string; testIds: string[] };

/**
 * A person's edit of a card (route 13): `props` as the gateway worked them out from the rules (null
 * removes a property), and with `criteria` (H3) the card's new criteria. Null when the version was
 * old; nothing changes then.
 */
export async function patchTask(
  ctx: Ctx,
  input: {
    id: string;
    version: number;
    props: Record<string, string | number | null>;
    criteria: CriterionWrite[] | null;
    createdBy: Actor;
    now: number;
  },
): Promise<{ version: number } | null> {
  const rows = await writeQuery<{ version: number }>(ctx.db, ctx.graph, "write/patch-task", {
    projectId: ctx.projectId,
    id: input.id,
    version: input.version,
    props: input.props,
    criteria:
      input.criteria?.map((k) => ({ ...k, id: ulid(), text: text(300).parse(k.text) })) ?? null,
    createdBy: input.createdBy,
    now: input.now,
  });
  return rows[0] ?? null;
}

/** Route 31: a blocked item back to open with attempts 0. Null when it is not blocked. */
export async function retryItem(ctx: Ctx, input: { id: string }): Promise<WorkItem | null> {
  const rows = await writeQuery<{ w: { properties: Record<string, unknown> } }>(
    ctx.db,
    ctx.graph,
    "write/retry-item",
    { projectId: ctx.projectId, id: input.id },
  );
  return rows[0] ? WorkItem.parse(rows[0].w.properties) : null;
}

/**
 * Rewrites cards in Rework (write_cards update mode, replan): fields, links and criteria (MERGE by
 * key; one left out loses its edge). Ids follow the input order (criteria card by card); `versions`
 * are the cards' new versions. Null when a card is not in Rework, its version is old, or a
 * requirement is not current; nothing is written then.
 */
export async function updateCards(
  ctx: Ctx,
  input: { cards: (CardWrite & { version: number })[]; createdBy: Actor; now: number },
): Promise<{ taskIds: string[]; versions: number[]; criterionIds: string[] } | null> {
  const rows = await writeQuery<{
    tasks: [string, string, number][];
    criteria: [string, string][];
  }>(ctx.db, ctx.graph, "write/write-cards-update", {
    projectId: ctx.projectId,
    cards: input.cards.map((c) => ({
      ...c,
      title: text(80).parse(c.title), // checked before it is written
      description: text(1200).parse(c.description),
      designKeys: [...new Set(c.designKeys)],
      dependsOn: [...new Set(c.dependsOn)],
      criteria: c.criteria.map((k) => ({ ...k, id: ulid(), text: text(300).parse(k.text) })),
    })),
    createdBy: input.createdBy,
    now: input.now,
  });
  const row = rows[0];
  if (!row) return null;
  const tasks = new Map(row.tasks.map(([key, id, version]) => [key, { id, version }]));
  const criteria = new Map(row.criteria);
  return {
    taskIds: input.cards.map((c) => tasks.get(c.key)!.id),
    versions: input.cards.map((c) => tasks.get(c.key)!.version),
    criterionIds: input.cards.flatMap((c) => c.criteria.map((k) => criteria.get(k.key)!)),
  };
}
