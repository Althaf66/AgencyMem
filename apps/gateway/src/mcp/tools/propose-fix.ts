import type { ToolInput, ToolOutput, WorkItemKind } from "@agencymem/contracts";
import { readQuery } from "@agencymem/graph";
import { proposeFix } from "@agencymem/memory";
import { ownership, reject } from "../guards";
import {
  agentOf,
  findOwn,
  guardFail,
  invalid,
  memoryCtx,
  ok,
  readNode,
  type Outcome,
  type ToolCtx,
} from "./common";

/**
 * propose_fix (contracts.md section 7). Guards: ownership (a maintenance item), source (an open
 * Defect of the project, a current requirement, known design keys and cards). The card key must be
 * free and its criteria keys its own. Writes the fix card in Backlog, FIXES to the Defect (now
 * fixing) and a waiting G6 that GUARDS the card, in one query.
 */
export async function proposeFixTool(
  ctx: ToolCtx,
  input: ToolInput<"propose_fix">,
): Promise<Outcome<ToolOutput<"propose_fix">>> {
  const { agent } = agentOf(ctx);
  const found = await findOwn(ctx, input.itemId, "WorkItem");
  if (!found.ok) return found;
  const refused = ownership({ kind: "agent", agent }, "propose_fix", {
    itemKind: found.output.kind as WorkItemKind,
  });
  if (refused) return guardFail(ctx, refused);

  const { db } = ctx;
  const { graph, projectId } = ctx.binding;
  const { card } = input;
  const unknown = (reason: string) => guardFail(ctx, reject("source", "SOURCE_UNKNOWN", reason));
  const defect = await readNode(ctx, input.defectId);
  if (defect?.label !== "Defect" || defect.props.projectId !== projectId) {
    return unknown(`${input.defectId} is not a defect of this project.`);
  }
  const [links] = await readQuery<{ links: { type: string; other: { id: string } }[] }>(
    db,
    graph,
    "read/node-links",
    { id: input.defectId },
  );
  const reported = links?.links.some(
    (l) => l.type === "REPORTED_IN" && l.other.id === found.output.subjectId,
  );
  if (!reported) return unknown(`${input.defectId} was not reported in this item's bug report.`);
  if (defect.props.status !== "open") {
    return invalid(
      `The defect is ${String(defect.props.status)}; only an open defect gets a fix card.`,
    );
  }
  const requirements = await readQuery<{ key: string }>(db, graph, "read/requirements", {
    projectId,
  });
  if (!requirements.some((r) => r.key === card.requirementKey)) {
    return unknown(`${card.requirementKey} is not a current requirement.`);
  }
  const design = new Set(
    (await readQuery<{ key: string }>(db, graph, "read/design", { projectId })).map((d) => d.key),
  );
  const noDesign = card.designKeys.find((k) => !design.has(k));
  if (noDesign) return unknown(`${noDesign} is not a design node.`);
  const tasks = new Set(
    (await readQuery<{ key: string }>(db, graph, "read/tasks", { projectId })).map((t) => t.key),
  );
  if (tasks.has(card.key)) return invalid(`${card.key} already exists.`);
  const noCard = card.dependsOn.find((k) => !tasks.has(k));
  if (noCard) return unknown(`${card.key} depends on ${noCard}, which is not a card.`);
  // A criterion key names its card, as in write_cards.
  const own = `AC-${card.key.slice("CARD-".length)}-`;
  const foreign = card.criteria.find((k) => !k.key.startsWith(own));
  if (foreign) return invalid(`${foreign.key} is not a criterion of ${card.key}.`);

  const written = await proposeFix(memoryCtx(ctx), {
    defectId: input.defectId,
    card,
    createdBy: agent,
    now: ctx.now(),
  });
  if (!written) {
    // Between the checks and the write, the defect, the key or the requirement changed.
    return guardFail(
      ctx,
      reject("version", "VERSION_OLD", "The defect, a card key or the requirement changed."),
    );
  }
  const { taskId, gateId, criterionIds } = written;
  ctx.events.emit(projectId, "node.written", {
    label: "Task",
    id: taskId,
    version: 1,
    summary: `Fix card ${card.key} in Backlog, waiting for G6`,
  });
  ctx.events.emit(projectId, "node.written", {
    label: "AcceptanceCriterion",
    id: criterionIds[0]!,
    version: 1,
    summary: `${criterionIds.length} acceptance criteria`,
    ids: criterionIds,
  });
  ctx.events.emit(projectId, "node.written", {
    label: "Defect",
    id: input.defectId,
    version: Number(defect.props.version) + 1,
    summary: `Defect fixing: ${card.key}`,
  });
  ctx.events.emit(projectId, "task.moved", {
    taskId,
    key: card.key,
    from: null,
    to: "Backlog",
    version: 1,
  });
  ctx.events.emit(projectId, "gate.changed", {
    gateId,
    gateKey: "G6",
    status: "waiting",
    decidedBy: null,
    reason: null,
  });
  return ok({ taskId, gateId });
}
