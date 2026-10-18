// A project delete (route DELETE /api/projects/:id) and test cleanup (agency graph): removes the given
// projects' CaseStudies and EstimateRecords, and the Lessons that name only those projects. A Lesson that also names another project keeps
// its other ids; its ratio and n are not recomputed and its text is not restored.
OPTIONAL MATCH (x)
WHERE (x:CaseStudy OR x:EstimateRecord) AND x.projectId IN $projectIds
DELETE x
WITH count(x) AS removed
CALL {
  MATCH (ls:Lesson)
  WHERE any(p IN ls.projectIds WHERE p IN $projectIds)
  WITH ls, [p IN ls.projectIds WHERE NOT p IN $projectIds] AS rest
  FOREACH (_ IN CASE WHEN size(rest) > 0 THEN [1] ELSE [] END | SET ls.projectIds = rest)
  WITH ls, rest
  WHERE size(rest) = 0
  DELETE ls
  RETURN count(*) AS lessons
}
RETURN removed, lessons
