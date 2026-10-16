// Records one commit from the post-commit hook (contracts.md section 9). The CodeChange MERGEs on
// its sha, so the same commit twice returns the first record. On a branch card/<key> whose card
// exists it is linked (FOR_TASK). T17: a linked commit by the build run (not by agencymem-test) on
// a card in In progress or Testing moves the card to Testing and opens a test_run item for the
// commit. One query, so the record, the link, the move and the item cannot split.
MERGE (c:CodeChange {projectId: $projectId, sha: $sha})
ON CREATE SET c.id = $id, c.branch = $branch, c.files = $files, c.message = $message,
  c.author = $author, c.committedAt = $committedAt, c.linked = false,
  c.createdBy = $createdBy, c.createdAt = $now, c.version = 1
WITH c, c.id = $id AS created
OPTIONAL MATCH (t:Task {projectId: $projectId, key: $cardKey})
WITH c, created, t, t.column AS fromColumn,
  created AND t IS NOT NULL AND $author <> 'agencymem-test'
    AND t.column IN ['In progress', 'Testing'] AS run
FOREACH (x IN CASE WHEN created AND t IS NOT NULL THEN [1] ELSE [] END |
  MERGE (c)-[:FOR_TASK]->(t)
  SET c.linked = true)
FOREACH (x IN CASE WHEN run THEN [1] ELSE [] END |
  SET t.version = t.version + CASE WHEN t.column = 'Testing' THEN 0 ELSE 1 END,
    t.column = 'Testing'
  CREATE (:WorkItem {id: $itemId, projectId: $projectId, kind: 'test_run', status: 'open',
    subjectId: c.id, outputIds: [], attempts: 0, createdBy: $createdBy, createdAt: $now,
    version: 1}))
RETURN c, created, t.id AS taskId, t.key AS taskKey, fromColumn, t.column AS toColumn,
  t.version AS taskVersion, CASE WHEN run THEN $itemId ELSE null END AS workItemId
