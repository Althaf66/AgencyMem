// write_case_study (contracts.md section 7), agency graph, one query:
// 1. Each Lesson MERGEs on (featureKind, clarityBand): its text becomes this project's, version + 1,
//    and the projectId joins projectIds. The MERGEs come first: after another write and an
//    aggregation, FalkorDB MERGEs every row onto the first node (gotcha 2).
// 2. The CaseStudy (metrics as CaseMetrics JSON) and, in a CALL, one EstimateRecord per feature.
// 3. Each given Lesson's ratio = the mean of actual / raw over every record of its pair (a record
//    with raw 0 is left out of the mean, but still counts in n), and n = the number of records of
//    the pair. toFloat: integer hours would divide as integers.
// One case study per project: when the project has one already, nothing is written and no row
// comes back. The gateway sends at least one lesson, so the first UNWIND keeps its row.
OPTIONAL MATCH (old:CaseStudy {projectId: $projectId})
WITH old
WHERE old IS NULL
UNWIND $lessons AS l
MERGE (ls:Lesson {featureKind: l.featureKind, clarityBand: l.clarityBand})
ON CREATE SET ls.id = l.id, ls.createdBy = $createdBy, ls.createdAt = $now, ls.version = 0,
  ls.projectIds = [], ls.ratio = 0, ls.n = 0
SET ls.text = l.text, ls.version = ls.version + 1,
  ls.projectIds = CASE WHEN $projectId IN ls.projectIds THEN ls.projectIds
    ELSE ls.projectIds + $projectId END
WITH collect(ls.id) AS lessonIds
CREATE (cs:CaseStudy {id: $id, projectId: $projectId, metrics: $metrics,
  lessonsLearned: $lessonsLearned, createdBy: $createdBy, createdAt: $now, version: 1})
WITH cs, lessonIds
CALL {
  UNWIND $records AS r
  CREATE (er:EstimateRecord {id: r.id, projectId: $projectId, featureKind: r.featureKind,
    clarityBand: r.clarityBand, estimate: r.estimate, raw: r.raw, actual: r.actual,
    createdBy: $createdBy, createdAt: $now, version: 1})
  RETURN collect(er.id) AS recordIds
}
CALL {
  WITH lessonIds
  MATCH (ls:Lesson) WHERE ls.id IN lessonIds
  OPTIONAL MATCH (er:EstimateRecord {featureKind: ls.featureKind, clarityBand: ls.clarityBand})
  WITH ls, avg(CASE WHEN er.raw > 0 THEN toFloat(er.actual) / er.raw END) AS ratio, count(er) AS n
  SET ls.ratio = coalesce(ratio, 0), ls.n = n
  RETURN count(ls) AS updated
}
RETURN cs.id AS caseStudyId, recordIds, lessonIds
