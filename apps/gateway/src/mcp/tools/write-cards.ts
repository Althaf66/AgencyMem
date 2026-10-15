import {
  findCycle,
  type GateStatus,
  type ToolInput,
  type ToolOutput,
  type WorkItemKind,
} from "@agencymem/contracts";
import { readQuery } from "@agencymem/graph";
import { updateCards, writeCards } from "@agencymem/memory";
import { gate, ownership, reject, source, version } from "../guards";
import {
  agentOf,
  fail,
  findOwn,
  guardFail,
  invalid,
  memoryCtx,
  ok,
  type Outcome,
  type ToolCtx,
} from "./common";

const repeated = (keys: string[]) => keys.find((key, i) => keys.indexOf(key) !== i);

type TaskRow = { key: string; column: string; version: number; dependsOn: string[] };

const cycleFail = (cycle: string[]) =>
  fail({
    code: "VALIDATION_FAILED",
    reason: `The cards depend on each other in a cycle: ${cycle.join(" -> ")}.`,
    details: { cycle },
  });

/**
 * write_cards (contracts.md section 7). Guards: ownership, gate G3, source (each card's requirement
 * is current; each design key names a design node), then version per card in update mode. Create
 * (a planner item): new keys only, dependencies only on cards of this call. Update (a replan item):
 * cards in Rework only, criteria keys of their own card, dependencies on any card. No cycle.
 */
export async function writeCardsTool(
  ctx: ToolCtx,
  input: ToolInput<"write_cards">,
): Promise<Outcome<ToolOutput<"write_cards">>> {
  const { agent } = agentOf(ctx);
  const found = await findOwn(ctx, input.itemId, "WorkItem");
  if (!found.ok) return found;
  const itemKind = found.output.kind as WorkItemKind;
  const refused = ownership({ kind: "agent", agent }, "write_cards", { itemKind });
  if (refused) return guardFail(ctx, refused);
  const update = input.mode === "update";
  if (update !== (itemKind === "replan")) {
    return invalid(`A ${itemKind} item writes cards in ${update ? "create" : "update"} mode.`);
  }

  const { db } = ctx;
  const { graph, projectId } = ctx.binding;
  const gates = await readQuery<{ g: { properties: { key: string; status: GateStatus } } }>(
    db,
    graph,
    "read/gates",
    { projectId },
  );
  const closed = gate("G3", gates.find((r) => r.g.properties.key === "G3")?.g.properties ?? null);
  if (closed) return guardFail(ctx, closed);

  const requirements = await readQuery<{ key: string }>(db, graph, "read/requirements", {
    projectId,
  });
  const noRequirement = source(
    input.cards.map((c) => ({ ids: [c.requirementKey] })),
    new Set(requirements.map((r) => r.key)),
  );
  if (noRequirement) return guardFail(ctx, noRequirement);
  const design = await readQuery<{ key: string }>(db, graph, "read/design", { projectId });
  const designKeys = new Set(design.map((d) => d.key));
  const unknownDesign = input.cards.findIndex((c) => c.designKeys.some((k) => !designKeys.has(k)));
  if (unknownDesign >= 0) {
    const card = input.cards[unknownDesign]!;
    const key = card.designKeys.find((k) => !designKeys.has(k));
    return guardFail(
      ctx,
      reject("source", "SOURCE_UNKNOWN", `${card.key} uses ${key}, which is not a design node.`, {
        index: unknownDesign,
      }),
    );
  }

  const keys = input.cards.map((c) => c.key);
  const twice =
    repeated(keys) ?? repeated(input.cards.flatMap((c) => c.criteria.map((k) => k.key)));
  if (twice) return invalid(`${twice} is written twice.`);
  const tasks = await readQuery<TaskRow>(db, graph, "read/tasks", { projectId });
  const byKey = new Map(tasks.map((t) => [t.key, t]));

  if (!update) {
    const unknownDep = input.cards.find((c) => c.dependsOn.some((k) => !keys.includes(k)));
    if (unknownDep) {
      return invalid(`${unknownDep.key} depends on a card that is not in this call.`);
    }
    const cycle = findCycle(input.cards);
    if (cycle) return cycleFail(cycle);
    const taken = keys.find((key) => byKey.has(key));
    if (taken) return invalid(`${taken} already exists.`);
    return created(ctx, input, agent);
  }

  for (const c of input.cards) {
    const current = byKey.get(c.key);
    if (current?.column !== "Rework") {
      return invalid(
        `${c.key} is ${current ? `in ${current.column}` : "not a card"}; only cards in Rework are updated.`,
      );
    }
    // A criterion key names its card, so an update never reaches another card's criteria.
    const own = `AC-${c.key.slice("CARD-".length)}-`;
    const foreign = c.criteria.find((k) => !k.key.startsWith(own));
    if (foreign) return invalid(`${foreign.key} is not a criterion of ${c.key}.`);
    const unknownDep = c.dependsOn.find((k) => !byKey.has(k));
    if (unknownDep) return invalid(`${c.key} depends on ${unknownDep}, which is not a card.`);
  }
  // The whole board's dependencies, with the updated cards' new ones.
  const updated = new Map(input.cards.map((c) => [c.key, c.dependsOn]));
  const cycle = findCycle(
    tasks.map((t) => ({ key: t.key, dependsOn: updated.get(t.key) ?? t.dependsOn })),
  );
  if (cycle) return cycleFail(cycle);
  for (const c of input.cards) {
    const stale = version(c.version!, byKey.get(c.key)!.version);
    if (stale) return guardFail(ctx, stale);
  }

  const written = await updateCards(memoryCtx(ctx), {
    cards: input.cards.map((c) => ({ ...c, version: c.version! })),
    createdBy: agent,
    now: ctx.now(),
  });
  if (!written) {
    // Between the checks above and the write, a card or a requirement changed.
    return guardFail(
      ctx,
      reject("version", "VERSION_OLD", "A card or a requirement changed; read again."),
    );
  }
  const { taskIds, versions, criterionIds } = written;
  ctx.events.emit(projectId, "node.written", {
    label: "Task",
    id: taskIds[0]!,
    version: versions[0]!,
    summary: `${taskIds.length} cards revised in Rework`,
    ids: taskIds,
  });
  ctx.events.emit(projectId, "node.written", {
    label: "AcceptanceCriterion",
    id: criterionIds[0]!,
    version: 1,
    summary: `${criterionIds.length} acceptance criteria`,
    ids: criterionIds,
  });
  return ok({ taskIds, criterionIds });
}

/** Create mode's write and events, after the checks. */
async function created(
  ctx: ToolCtx,
  input: ToolInput<"write_cards">,
  agent: ReturnType<typeof agentOf>["agent"],
): Promise<Outcome<ToolOutput<"write_cards">>> {
  const { projectId } = ctx.binding;
  const written = await writeCards(memoryCtx(ctx), {
    cards: input.cards,
    createdBy: agent,
    now: ctx.now(),
  });
  if (!written) {
    // Between the checks above and the write, a card key was taken or a requirement ended.
    return guardFail(
      ctx,
      reject("version", "VERSION_OLD", "A card key or a requirement changed; read again."),
    );
  }

  const { taskIds, criterionIds } = written;
  ctx.events.emit(projectId, "node.written", {
    label: "Task",
    id: taskIds[0]!,
    version: 1,
    summary: `${taskIds.length} cards in Backlog`,
    ids: taskIds,
  });
  ctx.events.emit(projectId, "node.written", {
    label: "AcceptanceCriterion",
    id: criterionIds[0]!,
    version: 1,
    summary: `${criterionIds.length} acceptance criteria`,
    ids: criterionIds,
  });
  input.cards.forEach((c, i) => {
    ctx.events.emit(projectId, "task.moved", {
      taskId: taskIds[i]!,
      key: c.key,
      from: null,
      to: "Backlog",
      version: 1,
    });
  });
  return ok({ taskIds, criterionIds });
}
