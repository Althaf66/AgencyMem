// The agency graph (task 5.4): write_case_study, and the test cleanup. One Cypher query per call.
import {
  text,
  type Actor,
  type CaseMetrics,
  type ClarityBand,
  type FeatureKind,
} from "@agencymem/contracts";
import { AGENCY_GRAPH, type FalkorDB } from "@agencymem/graph";
import { writeQuery } from "@agencymem/graph/write";
import { ulid } from "ulid";

type Pair = { featureKind: FeatureKind; clarityBand: ClarityBand };

/**
 * The CaseStudy, one EstimateRecord per feature, and each Lesson MERGEd on its pair with ratio and
 * n recomputed from every record. `lessons` must not be empty. Null when the project has a case
 * study already (nothing is written).
 */
export async function writeCaseStudy(
  db: FalkorDB,
  input: {
    projectId: string;
    metrics: CaseMetrics;
    lessonsLearned: string;
    records: (Pair & { estimate: number; raw: number; actual: number })[];
    lessons: (Pair & { text: string })[];
    createdBy: Actor;
    now: number;
  },
): Promise<{ caseStudyId: string; recordIds: string[]; lessonIds: string[] } | null> {
  const rows = await writeQuery<{ caseStudyId: string; recordIds: string[]; lessonIds: string[] }>(
    db,
    AGENCY_GRAPH,
    "write/case-study",
    {
      id: ulid(),
      projectId: input.projectId,
      metrics: JSON.stringify(input.metrics),
      lessonsLearned: text(1500).parse(input.lessonsLearned),
      records: input.records.map((r) => ({ ...r, id: ulid() })),
      lessons: input.lessons.map((l) => ({ ...l, id: ulid(), text: text(300).parse(l.text) })),
      createdBy: input.createdBy,
      now: input.now,
    },
  );
  return rows[0] ?? null;
}

/** Test cleanup only: removes test projects' case studies, records and their own Lessons. */
export async function deleteTestAgency(db: FalkorDB, projectIds: string[]): Promise<void> {
  if (projectIds.length) {
    await writeQuery(db, AGENCY_GRAPH, "write/delete-project-agency", { projectIds });
  }
}
