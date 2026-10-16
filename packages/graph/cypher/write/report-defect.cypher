// report_defect (contracts.md section 7): a Defect (status open) CAUSED_BY the CodeChange and
// REPORTED_IN the bug_report Episode, in one query. One Defect per report: a retried maintenance
// item gets the one already written. No row back: either node is not the project's.
MATCH (c:CodeChange {projectId: $projectId, id: $codeChangeId})
MATCH (e:Episode {projectId: $projectId, id: $episodeId, kind: 'bug_report'})
OPTIONAL MATCH (old:Defect)-[:REPORTED_IN]->(e)
FOREACH (x IN CASE WHEN old IS NULL THEN [1] ELSE [] END |
  CREATE (d:Defect {id: $id, projectId: $projectId, title: $title, severity: $severity,
    status: 'open', createdBy: $createdBy, createdAt: $now, version: 1})
  CREATE (d)-[:CAUSED_BY]->(c)
  CREATE (d)-[:REPORTED_IN]->(e))
WITH coalesce(old.id, $id) AS defectId
MATCH (d:Defect {id: defectId})
RETURN d
