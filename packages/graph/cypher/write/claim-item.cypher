// Claims the oldest open WorkItem of the given kinds (or the given item) whose lease is empty or
// ended. A merge item waits until every card its Task depends on has a mergedSha. One query, so
// two workers racing for one item cannot both win. No row back: nothing to claim.
MATCH (w:WorkItem {projectId: $projectId, status: 'open'})
WHERE w.kind IN $kinds
  AND (w.leaseUntil IS NULL OR w.leaseUntil < $now)
  AND ($itemId IS NULL OR w.id = $itemId)
OPTIONAL MATCH (t:Task)-[:DEPENDS_ON]->(d:Task)
WHERE w.kind = 'merge' AND t.id = w.subjectId AND d.mergedSha IS NULL
WITH w, count(d) AS unmerged
WHERE unmerged = 0
WITH w ORDER BY w.createdAt, w.id LIMIT 1
SET w.status = 'claimed', w.leaseOwner = $workerId, w.leaseUntil = $now + $leaseMs,
    w.version = w.version + 1
RETURN w
