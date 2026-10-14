// Every Project in the registry graph, with its client.
MATCH (p:Project)
RETURN p.id AS id, p.clientId AS clientId
ORDER BY p.createdAt
