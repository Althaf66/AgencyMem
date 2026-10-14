// The client graph of a project. No row: the project is unknown.
MATCH (p:Project {id: $projectId})
RETURN p.clientId AS clientId
