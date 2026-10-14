// Leaves a handoff on a WorkItem: the summary and the ids of what it wrote. With a launch report
// (C8), also writes one ReadinessReport in the same query. No row back: no such item in the project.
MATCH (w:WorkItem {id: $itemId, projectId: $projectId})
SET w.handoff = $summary, w.outputIds = $outputIds, w.version = w.version + 1
FOREACH (r IN CASE WHEN $report IS NULL THEN [] ELSE [$report] END |
  MERGE (rr:ReadinessReport {id: r.id})
  ON CREATE SET rr.projectId = $projectId, rr.passed = r.passed, rr.checks = r.checks,
    rr.override = false, rr.createdBy = $createdBy, rr.createdAt = $now, rr.version = 1)
RETURN w
