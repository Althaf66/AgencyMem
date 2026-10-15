import {
  findCycle,
  type GateStatus,
  type ToolInput,
  type ToolOutput,
  type WorkItemKind,
} from "@agencymem/contracts";
import { readQuery } from "@agencymem/graph";
import { writeCards } from "@agencymem/memory";
import { gate, ownership, reject, source } from "../guards";
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

/**
 * write_cards (contracts.md section 7), create mode. Guards: ownership, gate G3, source (each card's
 * requirement is current; each design key names a design node). Then the cards themselves: unique
 * card and criterion keys, dependencies only on cards of this call, no cycle, no key that exists.
 * Update mode (replan) is not built yet.
 */
export async function writeCardsTool(
  ctx: ToolCtx,
  input: ToolInput<"write_cards">,
): Promise<Outcome<ToolOutput<"write_cards">>> {
  const { agent } = agentOf(ctx);
  const found = await findOwn(ctx, input.itemId, "WorkItem");
  if (!found.ok) return found;
  const refused = ownership({ kind: "agent", agent }, "write_cards", {
    itemKind: found.output.kind as WorkItemKind,
  });
  if (refused) return guardFail(ctx, refused);
  // ponytail: update mode arrives with replan; no task builds it yet (decided in task 3.6).
  if (input.mode === "update") return invalid("write_cards update mode is not built yet.");

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
  const unknownDep = input.cards.find((c) => c.dependsOn.some((k) => !keys.includes(k)));
  if (unknownDep) {
    return invalid(`${unknownDep.key} depends on a card that is not in this call.`);
  }
  const cycle = findCycle(input.cards);
  if (cycle) {
    return fail({
      code: "VALIDATION_FAILED",
      reason: `The cards depend on each other in a cycle: ${cycle.join(" -> ")}.`,
      details: { cycle },
    });
  }
  const existing = await readQuery<{ key: string }>(db, graph, "read/tasks", { projectId });
  const taken = existing.find((t) => keys.includes(t.key));
  if (taken) return invalid(`${taken.key} already exists.`);

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
