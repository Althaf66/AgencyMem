// write_case_study is one per project: the project's CaseStudy, if any, with its EstimateRecords
// and the Lessons that name the project (agency graph).
MATCH (cs:CaseStudy {projectId: $projectId})
OPTIONAL MATCH (er:EstimateRecord {projectId: $projectId})
WITH cs, collect(er.id) AS recordIds
OPTIONAL MATCH (ls:Lesson)
WHERE $projectId IN ls.projectIds
RETURN cs.id AS caseStudyId, recordIds, collect(ls.id) AS lessonIds
