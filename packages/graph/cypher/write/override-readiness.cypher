// Route 29 (T28): a close over a failed readiness report keeps that it was overridden, and why, on
// the newest ReadinessReport. No row back: the project has no report.
MATCH (r:ReadinessReport {projectId: $projectId})
WITH r
ORDER BY r.createdAt DESC
LIMIT 1
SET r.override = true, r.reason = $reason, r.version = r.version + 1
RETURN r.id AS id, r.version AS version
