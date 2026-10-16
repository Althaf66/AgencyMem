// One CodeChange and the card it is linked to: the subject of a test_run item.
MATCH (c:CodeChange {projectId: $projectId, id: $id})
OPTIONAL MATCH (c)-[:FOR_TASK]->(t:Task)
RETURN c.id AS id, c.sha AS sha, c.branch AS branch, t.key AS taskKey, t.id AS taskId,
  c.files AS files, c.message AS message, c.committedAt AS committedAt, c.linked AS linked
