// One CodeChange and the card it is linked to: the subject of a test_run item. With $id null, every
// CodeChange of the project, oldest first: the Launch agent's drift check.
MATCH (c:CodeChange {projectId: $projectId})
WHERE $id IS NULL OR c.id = $id
OPTIONAL MATCH (c)-[:FOR_TASK]->(t:Task)
RETURN c.id AS id, c.sha AS sha, c.branch AS branch, t.key AS taskKey, t.id AS taskId,
  c.files AS files, c.message AS message, c.committedAt AS committedAt, c.linked AS linked
ORDER BY committedAt, id
