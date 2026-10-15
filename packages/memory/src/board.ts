// The board's cards (write_cards). One Cypher query per call.
import { text, type Actor, type Lane } from "@agencymem/contracts";
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
