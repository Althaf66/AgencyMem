// Creates a Project in the registry graph. A client is found by its exact name or created, so a
// second project for the same client shares the client graph. One query.
MERGE (c:Client {name: $clientName})
ON CREATE SET c.id = $clientId, c.createdBy = $createdBy, c.createdAt = $now, c.version = 1
CREATE (p:Project {id: $projectId, clientId: c.id, name: $projectName, mode: $mode,
  stage: 'intake', rejectedWrites: 0, rejectedClaims: 0, rejectedCompletions: 0,
  rejectedQueries: 0, createdBy: $createdBy, createdAt: $now, version: 1})
RETURN c, p
