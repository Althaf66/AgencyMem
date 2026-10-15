// Creates the project's Gates that do not exist yet, each waiting (stage-machine.md T1 and the
// startup repair). MERGE on project and key makes it safe to run twice. Returns only the new Gates.
UNWIND $gates AS g
MERGE (x:Gate {projectId: $projectId, key: g.key})
ON CREATE SET x.id = g.id, x.status = 'waiting', x.createdBy = $createdBy, x.createdAt = $now,
  x.version = 1
WITH x, g
WHERE x.id = g.id
RETURN x
