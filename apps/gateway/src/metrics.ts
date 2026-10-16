// A project's CaseMetrics (contracts.md section 5) from read/case-metrics.cypher (approved decision
// 15): recall_context for the Curator now, routes 24 and 25 in task 5.6.
import type { CaseMetrics, ClarityBand } from "@agencymem/contracts";
import { readQuery, type FalkorDB } from "@agencymem/graph";

type Commit = { sha: string; committedAt: number; createdAt: number };
type Row = Omit<
  CaseMetrics,
  "estimateError" | "cardsReopened" | "cards" | "firstPassCards" | "clarityBand"
> & {
  features: { hours: number; actual: number | null }[];
  cards: { reopened: number; commits: Commit[]; runs: { sha: string; passed: boolean }[] }[];
};

/** The first build commit: committedAt is whole seconds, so ties go by when it was recorded. */
const first = (commits: Commit[]) =>
  [...commits].sort((a, b) => a.committedAt - b.committedAt || a.createdAt - b.createdAt)[0];

export async function caseMetrics(
  db: FalkorDB,
  graph: string,
  projectId: string,
  clarityBand: ClarityBand,
): Promise<CaseMetrics> {
  const [row] = await readQuery<Row>(db, graph, "read/case-metrics", { projectId });
  const { features, cards, ...counts } = row!; // the query always returns one row
  // ponytail: a feature with no (or 0) actual hours has no error to measure; none at all gives 0.
  const measured = features.filter((f) => (f.actual ?? 0) > 0);
  const estimateError = measured.length
    ? measured.reduce((sum, f) => sum + Math.abs(f.hours - f.actual!) / f.actual!, 0) /
      measured.length
    : 0;
  const firstPass = cards.filter((c) => {
    const sha = first(c.commits)?.sha;
    const runs = c.runs.filter((r) => r.sha === sha);
    return runs.length > 0 && runs.every((r) => r.passed);
  });
  return {
    estimateError,
    ...counts,
    cardsReopened: cards.reduce((sum, c) => sum + c.reopened, 0),
    cards: cards.length,
    firstPassCards: firstPass.length,
    clarityBand,
  };
}
