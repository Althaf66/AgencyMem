// T23: approves a waiting G5 at the version the person saw and records the Deployment, in one query
// (stage-machine.md section 5). With $override, the gate and the newest ReadinessReport keep that
// the failed report was approved anyway, and the gate keeps the reason. No row back: the gate
// changed (old version or no longer waiting).
MATCH (g:Gate {id: $gateId, projectId: $projectId, key: 'G5'})
WHERE g.status = 'waiting' AND g.version = $version
OPTIONAL MATCH (r:ReadinessReport {projectId: $projectId})
WITH g, r
ORDER BY r.createdAt DESC
LIMIT 1
SET g.status = 'approved', g.decidedBy = $actor, g.decidedAt = $now, g.reason = $reason,
    g.override = $override, g.version = g.version + 1
FOREACH (x IN CASE WHEN $override AND r IS NOT NULL THEN [r] ELSE [] END |
  SET x.override = true, x.version = x.version + 1)
CREATE (d:Deployment {id: $deploymentId, projectId: $projectId, environment: $environment,
  deployedAt: $now, deployedBy: $actor, createdBy: $actor, createdAt: $now, version: 1})
RETURN g, d.id AS deploymentId
