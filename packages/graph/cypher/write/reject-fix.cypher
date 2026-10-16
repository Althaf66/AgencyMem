// T27 (stage-machine.md): rejects a waiting G6 at the version the person saw, in one query. Its
// Defect becomes wont_fix and the fix card keeps "Fix rejected: <reason>" as its note, still in
// Backlog. No row back: the gate changed (old version or no longer waiting).
MATCH (g:Gate {id: $gateId, projectId: $projectId, key: 'G6'})-[:GUARDS]->(t:Task)
WHERE g.status = 'waiting' AND g.version = $version
OPTIONAL MATCH (t)-[:FIXES]->(d:Defect)
SET g.status = 'rejected', g.decidedBy = $actor, g.decidedAt = $now, g.reason = $reason,
    g.version = g.version + 1,
    t.note = $note, t.version = t.version + 1
FOREACH (x IN CASE WHEN d IS NULL THEN [] ELSE [d] END |
  SET x.status = 'wont_fix', x.version = x.version + 1)
RETURN g, t.id AS taskId, t.key AS key, t.version AS taskVersion, d.id AS defectId,
  d.version AS defectVersion
