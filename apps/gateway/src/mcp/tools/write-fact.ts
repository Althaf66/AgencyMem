import type { FactInput, ToolInput, ToolOutput, WorkItemKind } from "@agencymem/contracts";
import { readQuery } from "@agencymem/graph";
import { writeFacts, type EntityWrite } from "@agencymem/memory";
import { ownership, source } from "../guards";
import {
  agentOf,
  findOwn,
  guardFail,
  invalid,
  memoryCtx,
  ok,
  type Outcome,
  type ToolCtx,
} from "./common";

type Entity = { key: string; name: string; aliases: string[] };

// Blank words never match: a blank alias would merge unrelated entities.
const words = (e: Entity) =>
  [e.name, ...e.aliases].map((w) => w.trim().toLowerCase()).filter((w) => w !== "");

/** The aliases of `into` plus each other word of `from`, without case-insensitive repeats. */
function mergeAliases(into: Entity, from: Entity): string[] {
  const seen = new Set(words(into));
  const aliases = [...into.aliases];
  for (const word of [from.name, ...from.aliases]) {
    if (word.trim() === "" || seen.has(word.trim().toLowerCase())) continue;
    seen.add(word.trim().toLowerCase());
    aliases.push(word);
  }
  return aliases;
}

/**
 * Entity matching (contracts.md, write_fact): an input entity whose name or an alias matches an
 * existing entity's name or alias, ignoring case, takes the existing key, and its other words become
 * aliases there. Returns the Entities to write and the key each input key resolves to.
 * ponytail: matched against the graph read before the write, so two calls at the same moment can
 * still create the same entity twice; match inside the write query if that ever shows up.
 */
function resolveEntities(existing: Entity[], facts: FactInput[]) {
  const known = new Map(existing.map((e) => [e.key, { ...e }]));
  const resolved = new Map<string, string>(); // input key -> written key
  const touched = new Set<string>();
  for (const { entity } of facts) {
    const theirs = new Set(words(entity));
    const match =
      known.get(resolved.get(entity.key) ?? entity.key) ??
      [...known.values()].find((e) => words(e).some((w) => theirs.has(w)));
    if (match) {
      match.aliases = mergeAliases(match, entity);
      resolved.set(entity.key, match.key);
      touched.add(match.key);
    } else {
      const fresh = { key: entity.key, name: entity.name, aliases: [] };
      known.set(entity.key, { ...fresh, aliases: mergeAliases(fresh, entity) });
      resolved.set(entity.key, entity.key);
      touched.add(entity.key);
    }
  }
  const entities: EntityWrite[] = [...touched].map((key) => known.get(key)!);
  return { entities, resolved };
}

/**
 * write_fact (contracts.md section 7). Guards: ownership, source. Writes Facts with SOURCED_FROM and
 * ABOUT, matches Entities through their aliases, and supersedes a replaced fact (intake_answer only).
 */
export async function writeFactTool(
  ctx: ToolCtx,
  input: ToolInput<"write_fact">,
): Promise<Outcome<ToolOutput<"write_fact">>> {
  const { agent } = agentOf(ctx);
  const found = await findOwn(ctx, input.itemId, "WorkItem");
  if (!found.ok) return found;
  const itemKind = found.output.kind as WorkItemKind;

  const refused = ownership({ kind: "agent", agent }, "write_fact", { itemKind });
  if (refused) return guardFail(ctx, refused);

  // Checks and the replacesFactId lookups (which can fail tenancy) come before the source guard.
  const replaced = new Set<string>();
  for (const [i, fact] of input.facts.entries()) {
    if (fact.subject !== fact.entity.key) {
      return invalid(
        `Fact ${i}: subject ${fact.subject} must be its entity key ${fact.entity.key}.`,
      );
    }
    if (!fact.replacesFactId) continue;
    if (replaced.has(fact.replacesFactId)) {
      return invalid(`Fact ${i}: fact ${fact.replacesFactId} is replaced twice in one call.`);
    }
    replaced.add(fact.replacesFactId);
    if (itemKind !== "intake_answer") {
      return invalid(`Fact ${i}: replacesFactId is only for intake_answer items.`);
    }
    const old = await findOwn(ctx, fact.replacesFactId, "Fact");
    if (!old.ok) return old;
    if (old.output.validTo != null)
      return invalid(`Fact ${i}: fact ${fact.replacesFactId} is already replaced.`);
  }

  const { db } = ctx;
  const { graph, projectId } = ctx.binding;
  const ids = [...new Set(input.facts.flatMap((f) => f.episodeIds))];
  const rows = await readQuery<{ id: string }>(db, graph, "read/episode-ids", { ids, projectId });
  const missing = source(
    input.facts.map((f) => ({ ids: f.episodeIds })),
    new Set(rows.map((r) => r.id)),
  );
  if (missing) return guardFail(ctx, missing);

  const existing = await readQuery<Entity>(db, graph, "read/entities", { projectId });
  const { entities, resolved } = resolveEntities(existing, input.facts);
  const now = ctx.now();
  const written = await writeFacts(memoryCtx(ctx), {
    entities,
    facts: input.facts.map((f) => ({
      statement: f.statement,
      subject: resolved.get(f.entity.key)!,
      attribute: f.attribute,
      value: f.value,
      episodeIds: f.episodeIds,
      replacesFactId: f.replacesFactId ?? null,
    })),
    createdBy: agent,
    now,
  });

  ctx.events.emit(projectId, "node.written", {
    label: "Fact",
    id: written.factIds[0]!,
    version: 1,
    summary: `${written.factIds.length} facts`,
    ids: written.factIds,
  });
  ctx.events.emit(projectId, "node.written", {
    label: "Entity",
    id: written.entityIds[0]!,
    version: 1,
    summary: `${written.entityIds.length} entities`,
    ids: written.entityIds,
  });
  for (const [ended, replacedBy] of written.superseded) {
    ctx.events.emit(projectId, "node.ended", { factId: ended, validTo: now, replacedBy });
  }
  return ok({
    factIds: written.factIds,
    entityIds: written.entityIds,
    superseded: written.superseded.map(([ended]) => ended),
  });
}
