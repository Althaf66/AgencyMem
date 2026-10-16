// Ends a build run on a card (complete_task, contracts.md section 7). Only while the caller's lease
// is live, and for `done` only while no build commit newer than the one the evidence guard checked
// has arrived (the same order as the gateway's: committedAt, then createdAt, then id): the check and the change cannot split. `done`: the card goes to Done and a merge item
// opens (T19) unless one is open. `failed`: the card goes back to Ready with attempts + 1 and the
// note. Either way the lease is cleared. No row back: the lease or the evidence changed.
MATCH (t:Task {projectId: $projectId, id: $taskId})
WHERE t.leaseOwner = $workerId AND t.leaseUntil >= $now
OPTIONAL MATCH (n:CodeChange)-[:FOR_TASK]->(t)
WHERE n.author <> 'agencymem-test' AND n.id <> $latestId
  AND (n.committedAt > $latestAt
    OR (n.committedAt = $latestAt AND (n.createdAt > $latestCreatedAt
      OR (n.createdAt = $latestCreatedAt AND n.id > $latestId))))
WITH t, t.column AS fromColumn, count(n) AS newer
WHERE $outcome = 'failed' OR newer = 0
OPTIONAL MATCH (e:WorkItem {projectId: $projectId, kind: 'merge', subjectId: $taskId})
WHERE e.status IN ['open', 'claimed']
WITH t, fromColumn, count(e) AS openMerge
// A fix card that closes fixes its Defect (approved decision 7).
OPTIONAL MATCH (t)-[:FIXES]->(fd:Defect)
WITH t, fromColumn, openMerge, fd
SET t.version = t.version + 1, t.leaseOwner = null, t.leaseUntil = null,
  t.column = CASE WHEN $outcome = 'done' THEN 'Done' ELSE 'Ready' END,
  t.attempts = t.attempts + CASE WHEN $outcome = 'failed' THEN 1 ELSE 0 END,
  t.note = CASE
    WHEN $outcome = 'failed' AND $note IS NOT NULL THEN $note
    // A closed card keeps no reason that only explained why it could not close yet.
    WHEN $outcome = 'done' AND (t.note STARTS WITH 'Rejected by evidence guard:'
      OR t.note STARTS WITH 'Tests failed:' OR t.note STARTS WITH 'Merge conflict:') THEN null
    ELSE t.note END
FOREACH (x IN CASE WHEN $outcome = 'done' AND fd IS NOT NULL THEN [fd] ELSE [] END |
  SET x.status = 'fixed', x.version = x.version + 1)
FOREACH (x IN CASE WHEN $outcome = 'done' AND openMerge = 0 THEN [1] ELSE [] END |
  CREATE (:WorkItem {id: $itemId, projectId: $projectId, kind: 'merge', status: 'open',
    subjectId: $taskId, outputIds: [], attempts: 0, createdBy: $createdBy, createdAt: $now,
    version: 1}))
RETURN t.key AS key, fromColumn, t.column AS toColumn, t.version AS version,
  CASE WHEN $outcome = 'done' THEN fd.id ELSE null END AS fixedDefectId, fd.version AS defectVersion,
  CASE WHEN $outcome = 'done' AND openMerge = 0 THEN $itemId ELSE null END AS mergeItemId
