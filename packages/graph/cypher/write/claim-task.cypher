// Claims a build card (contracts.md claim_task, C1): a Ready card, or an In progress or Testing card
// whose lease ended, under 2 attempts, with every card it depends on Done. Lowest order first. One
// query, so two workers racing for one card cannot both win. No row back: nothing to claim.
MATCH (t:Task {projectId: $projectId})
WHERE (t.column = 'Ready' OR (t.column IN ['In progress', 'Testing'] AND t.leaseUntil < $now))
  AND (t.leaseUntil IS NULL OR t.leaseUntil < $now)
  AND t.attempts < 2
  AND ($taskId IS NULL OR t.id = $taskId)
OPTIONAL MATCH (t)-[:DEPENDS_ON]->(d:Task)
WITH t, sum(CASE WHEN d IS NOT NULL AND d.column <> 'Done' THEN 1 ELSE 0 END) AS openDeps
WHERE openDeps = 0
WITH t ORDER BY t.order, t.id LIMIT 1
WITH t, t.column AS fromColumn
SET t.leaseOwner = $workerId, t.leaseUntil = $now + $leaseMs,
    t.column = 'In progress', t.version = t.version + 1
RETURN t, fromColumn
