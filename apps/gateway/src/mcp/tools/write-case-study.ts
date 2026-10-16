import type { ToolInput, ToolOutput, WorkItemKind } from "@agencymem/contracts";
import { AGENCY_GRAPH, readQuery } from "@agencymem/graph";
import { writeCaseStudy } from "@agencymem/memory";
import { projectInfo } from "../../project-info";
import { anonymity, ownership } from "../guards";
import { agentOf, findOwn, guardFail, invalid, ok, type Outcome, type ToolCtx } from "./common";

type Written = ToolOutput<"write_case_study">;

/**
 * write_case_study (contracts.md section 7). Guards: ownership (a curator item), anonymity (the
 * lessons learned and every lesson text against the project's Entity names and aliases and its
 * client's name, plus emails and URLs). Writes to the agency graph only, in one query. One case
 * study per project: a repeated call returns the ids already written and writes nothing.
 */
export async function writeCaseStudyTool(
  ctx: ToolCtx,
  input: ToolInput<"write_case_study">,
): Promise<Outcome<Written>> {
  const { agent } = agentOf(ctx);
  const found = await findOwn(ctx, input.itemId, "WorkItem");
  if (!found.ok) return found;
  const refused = ownership({ kind: "agent", agent }, "write_case_study", {
    itemKind: found.output.kind as WorkItemKind,
  });
  if (refused) return guardFail(ctx, refused);
  if (!input.lessons.length) return invalid("At least one lesson is needed.");
  const pairs = new Set(input.lessons.map((l) => `${l.featureKind}/${l.clarityBand}`));
  if (pairs.size !== input.lessons.length) {
    return invalid("Each (featureKind, clarityBand) pair takes one lesson.");
  }

  const { projectId, graph } = ctx.binding;
  const entities = await readQuery<{ name: string; aliases: string[] }>(
    ctx.db,
    graph,
    "read/entities",
    { projectId },
  );
  const project = await projectInfo(ctx.db, projectId);
  const names = [
    ...(project ? [project.clientName] : []),
    ...entities.flatMap((e) => [e.name, ...e.aliases]),
  ];
  const named = anonymity(
    [input.caseStudy.lessonsLearned, ...input.lessons.map((l) => l.text)],
    names,
  );
  if (named) return guardFail(ctx, named);

  const existing = async () =>
    (await readQuery<Written>(ctx.db, AGENCY_GRAPH, "read/case-study", { projectId }))[0];
  const before = await existing();
  if (before) return ok(before);

  const written = await writeCaseStudy(ctx.db, {
    projectId,
    metrics: input.caseStudy.metrics,
    lessonsLearned: input.caseStudy.lessonsLearned,
    records: input.records,
    lessons: input.lessons,
    createdBy: agent,
    now: ctx.now(),
  });
  if (!written) return ok((await existing())!); // a concurrent call wrote it first
  // The agency graph has no seq of its own: its events go out on the project's stream.
  ctx.events.emit(projectId, "node.written", {
    label: "CaseStudy",
    id: written.caseStudyId,
    version: 1,
    summary: `Case study with ${written.lessonIds.length} lessons`,
  });
  if (written.recordIds.length) {
    ctx.events.emit(projectId, "node.written", {
      label: "EstimateRecord",
      id: written.recordIds[0]!,
      version: 1,
      summary: `${written.recordIds.length} estimate records`,
      ids: written.recordIds,
    });
  }
  ctx.events.emit(projectId, "node.written", {
    label: "Lesson",
    id: written.lessonIds[0]!,
    version: 1, // ponytail: a MERGEd Lesson's version is not returned; a client reloads it
    summary: `${written.lessonIds.length} lessons updated`,
    ids: written.lessonIds,
  });
  ctx.events.emit(projectId, "metrics.updated", {
    metric: "estimateError",
    value: input.caseStudy.metrics.estimateError,
  });
  return ok(written);
}
