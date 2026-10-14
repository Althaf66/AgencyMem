// A Project and its client's name, from the registry graph (ProjectInfo).
MATCH (p:Project {id: $projectId})
OPTIONAL MATCH (c:Client)
WHERE c.id = p.clientId
RETURN p, c.name AS clientName
