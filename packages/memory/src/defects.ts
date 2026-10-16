// Maintenance (task 5.3): the bug report (route 28), report_defect and propose_fix. One Cypher query
// per call.
import { Defect, Episode, text, type Actor, type DefectSeverity } from "@agencymem/contracts";
import { writeQuery } from "@agencymem/graph/write";
import { ulid } from "ulid";
import type { CardWrite } from "./board";
import type { Ctx } from "./ctx";

type Props = { properties: Record<string, unknown> };

/** T24: the bug_report Episode with the person's words. */
export async function writeBugReport(
  ctx: Ctx,
  input: { text: string; createdBy: Actor; now: number },
): Promise<Episode> {
  const rows = await writeQuery<{ e: Props }>(ctx.db, ctx.graph, "write/bug-report", {
    id: ulid(),
    projectId: ctx.projectId,
    text: text(2000).min(1).parse(input.text), // checked before it is written
    createdBy: input.createdBy,
    now: input.now,
  });
  if (!rows[0]) throw new Error("bug-report returned no row");
  return Episode.parse(rows[0].e.properties);
}

/**
 * An open Defect CAUSED_BY the CodeChange and REPORTED_IN the bug_report Episode. Null when either
 * is not the project's.
 */
export async function reportDefect(
  ctx: Ctx,
  input: {
    title: string;
    severity: DefectSeverity;
    codeChangeId: string;
    reportEpisodeId: string;
    createdBy: Actor;
    now: number;
  },
): Promise<Defect | null> {
  const rows = await writeQuery<{ d: Props }>(ctx.db, ctx.graph, "write/report-defect", {
    id: ulid(),
    projectId: ctx.projectId,
    title: text(120).parse(input.title),
    severity: input.severity,
    codeChangeId: input.codeChangeId,
    episodeId: input.reportEpisodeId,
    createdBy: input.createdBy,
    now: input.now,
  });
  return rows[0] ? Defect.parse(rows[0].d.properties) : null;
}

/**
 * The fix card (a fix Task in Backlog) for an open Defect, which becomes fixing, with a waiting G6
 * that GUARDS it. Null when the Defect is not open, the key is taken or the requirement ended.
 */
export async function proposeFix(
  ctx: Ctx,
  input: { defectId: string; card: CardWrite; createdBy: Actor; now: number },
): Promise<{ taskId: string; gateId: string; criterionIds: string[] } | null> {
  const { card } = input;
  const criteria = card.criteria.map((k) => ({ ...k, id: ulid(), text: text(300).parse(k.text) }));
  const ids = { taskId: ulid(), gateId: ulid() };
  const rows = await writeQuery(ctx.db, ctx.graph, "write/propose-fix", {
    projectId: ctx.projectId,
    defectId: input.defectId,
    ...ids,
    key: card.key,
    title: text(80).parse(card.title),
    description: text(1200).parse(card.description),
    lane: card.lane,
    order: card.order,
    requirementKey: card.requirementKey,
    designKeys: [...new Set(card.designKeys)],
    dependsOn: [...new Set(card.dependsOn)],
    criteria,
    createdBy: input.createdBy,
    now: input.now,
  });
  return rows[0] ? { ...ids, criterionIds: criteria.map((k) => k.id) } : null;
}
