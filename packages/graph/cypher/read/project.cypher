// One Project node from the registry graph.
MATCH (p:Project {id: $projectId})
RETURN p
